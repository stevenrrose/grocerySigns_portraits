/*
 *
 * IMAP scraping functions.
 *
 */

(function(providers) {
    /*
     *
     * Provider metadata (both server & client).
     *
     */
    var provider = new Provider("IMAP", /*TODO remove*/ /^$/);
    provider.hasDate = true;
    providers[provider.name] = provider;
        
    /** Authorization/access cookie name. */
    var authCookie = 'imap_auth';
    
    /** User data cookie name. */
    var userCookie = 'imap_user';
    
    if (typeof(exports) !== 'undefined') {
        /*
         *
         * Interface with our IMAP API (server only).
         *
         */
         
        const request = require('request');
        const swig = require('swig');
        const crypto = require('crypto');
        const bodyParser = require('body-parser');
        const imaps = require('imap-simple');
        
        /** API and session keys stored on server. MUST BE KEPT SECRET!!! */
        var imapConfig;
        try {
            imapConfig = require('../config/imap.local.json');
        } catch (e) {
            imapConfig = require('../config/imap.json');
        }
        
        /**
         * loginPageTpl
         * 
         * Template file for login page.
         */
        var loginPageTpl = swig.compileFile(__dirname + '/imap_login.html');
        
        /**
         * callbackPageTpl
         * 
         * Template file for callback page.
         */
        var callbackPageTpl = swig.compileFile(__dirname + '/imap_callback.html');

        /**
         * Generic authentication error handler.
         *
         *  @param res      Express response.
         *  @param message  Human-readable message (used for logs).
         *  @param status   Status code.
         *
         *  @return *res*
         */
        var authError = function(res, message, status) {
            console.log(message);
            res.clearCookie(authCookie);
            var code;
            switch (status) {
                case 'forbidden':       code = 403; break;
                case 'not_authorized':  code = 401; break;
                default:                code = 400; break;
            }
            return res.status(code).send(callbackPageTpl({status: status, data: 'null'}));
        }
        
        /**
         * Encrypt string. Used for cookies with sensitive data (request/access tokens).
         *
         *  @param string   Cleartext string.
         *
         *  @return encrypted string.
         *
         *  @see decrypt()
         */
        var encrypt = function(string) {
            var cipher = crypto.createCipher('aes192', imapConfig.cookiePassword);
            var encrypted = cipher.update(string, 'utf8', 'base64');
            encrypted += cipher.final('base64');
            return encrypted;
        };
        
        /**
         * Decrypt string. Used for cookies with sensitive data (request/access tokens).
         *
         *  @param string   Encrypted string.
         *
         *  @return decrypted string.
         *
         *  @see encrypt()
         */
        var decrypt = function(string) {
            var decipher = crypto.createDecipher('aes192', imapConfig.cookiePassword);
            var decrypted = decipher.update(string, 'base64', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        };
        
        /**
         * Define IMAP-specific routes.
         *
         *  @param app  The Express router instance.
         */
        provider.initRoutes = function(app) {
            app.use(bodyParser.urlencoded({ extended: true }));

            /**
             * /imap/login
             *
             * Display IMAP login page.
             */
            app.get('/imap/login', function(req, res) {
                return res.send(loginPageTpl({callbackUrl: imapConfig.callback}));
            });
            
            /**
             * /imap/callback
             *
             * Callback for the authentication window.
             */
            app.post('/imap/callback', async function(req, res, next) {
                // Generic error handler.
                if (req.get("Referer") !== imapConfig.login) {
                    return authError(res, "Access denied", 'forbiddden');
                }

                try {
                    // Attempt to connect to IMAP server.
                    const accessData = {
                        imap: {
                            user: req.body.username,
                            password: req.body.password,
                            host: req.body.host,
                            port: req.body.port,
                            tls: !!req.body.tls,
                            authTimeout: 3000
                        }
                    };
                    await imaps.connect(accessData);

                    // Success!
                    console.log("IMAP user authenticated", accessData.imap.user);
                    const host = accessData.imap.host + ':' + accessData.imap.port;
                    const url = 
                        (accessData.imap.tls ? "imaps" : "imap") + "://"
                        + encodeURIComponent(accessData.imap.user)
                        + "@" + host
                        + "/";
                    const userData = {id: url, url: url, username: accessData.imap.user, host: host};
                    
                    // Store IMAP access data in authorization cookie.
                    res.cookie(authCookie, encrypt(JSON.stringify(accessData)), {signed: true});
                    
                    // Store user data in plain cookie.
                    res.cookie(userCookie, JSON.stringify(userData));
                        
                    return res.send(callbackPageTpl({status: 'connected', data: JSON.stringify(userData)}));
                } catch (e) {
                    return authError(res, e.message, e.code);
                }
            });
     
            /**
             * /imap/oldest
             *
             * Get timestamp of oldest message for the current user.
             */
            app.get('/imap/oldest', async function(req, res) {
                // Get access data from cookie.
                let accessData;
                try {
                    accessData = JSON.parse(decrypt(req.signedCookies[authCookie]));
                } catch (e) {
                    // Missing or misformed cookie.
                    return authError(res, "Missing cookie", 'error');
                }
                try {
                    const connection = await imaps.connect(accessData);
                    await connection.openBox('INBOX');
                    
                    // Try to find oldest year with at least one message.
                    const thisYear = new Date().getFullYear();
                    let year;
                    for (year = 2000 /* arbitrary */; year < thisYear; year++) {
                        const searchCriteria = [['BEFORE', new Date(year.toString())]];
                        const m = await connection.search(searchCriteria, {});
                        if (m.length) break
                    }
                    const oldest = new Date(year.toString());
                    return res.send(getTimestampFromDate(oldest).toString());
                } catch (e) {
                    return authError(res, "Access denied", 'forbiddden');
                }
            });

            /**
             * /imap/messages?since={timestamp}&until={timestamp}
             *
             * Get messages for the current user.
             *
             *  @param since    Minimum message timestamp.
             *  @param until    Maximum message timestamp.
             */
            app.get('/imap/messages', async function(req, res) {
                var since = req.query.since;
                var until = req.query.until;
 
                // Get access data from cookie.
                let accessData;
                try {
                    accessData = JSON.parse(decrypt(req.signedCookies[authCookie]));
                } catch (e) {
                    // Missing or misformed cookie.
                    return authError(res, "Missing cookie", 'error');
                }

                try {
                    const connection = await imaps.connect(accessData);
                    await connection.openBox('INBOX');

                    // Get all messages in given date interval.
                    var fetchOptions = { bodies: ['HEADER.FIELDS (SUBJECT)'], struct: true };
                    var searchCriteria = [];
                    if (since) {searchCriteria.push(['SINCE', getDateFromTimestamp(since)])};
                    if (until) {searchCriteria.push(['BEFORE', getDateFromTimestamp(until)])};
                    const messages = await connection.search(searchCriteria, fetchOptions);
                    var result = [];
                    for (let message of messages) {
                        const subject = message.parts[0].body.subject[0];

                        // Fetch parts of interest: plain text or images.
                        var parts = [];
                        for (let part of imaps.getParts(message.attributes.struct)) {
                            if (part.type === 'text' && part.subtype === 'plain') {
                                const mimeType = part.type + '/' + part.subtype;
                                const data = await connection.getPartData(message, part);
                                let text;
                                if (data instanceof Buffer) {
                                    // TODO encoding conversion?
                                    text = data.toString();
                                } else {
                                    text = data;
                                }
                                parts.push({mimeType, data: text});
                            } else if (part.type === 'image') {
                                const mimeType = part.type + '/' + part.subtype;
                                const data = await connection.getPartData(message, part);
                                parts.push({mimeType, data: data.toString('base64')});
                            }
                        }
                        result.push({subject, parts});
                    }
                    return res.send(result);
                } catch (e) {
                    return authError(res, "Access denied", 'forbiddden');
                }
            });
        };
        return;
    }
    
    
    /*
     *
     * Interface with the IMAP server endpoints (client only).
     *
     */
    
    // No remote API to load as everything is here, but we have to signal the 'loaded' event anyway once everything is ready.
    window.imapAsyncInit = function() {
        console.debug("IMAP API ready");

        if (isAuthorized()) {
            // Issue auth event when already signed in.
            provider.dispatchEvent(new CustomEvent('auth', {detail: {message: "Signed in", authorized: true}}));
        }
        
        // Done! Send loaded event to all listeners.
        provider.dispatchEvent(new CustomEvent('loaded', {detail: {message: "API loaded"}}));
    };
    $(function() { window.setTimeout(imapAsyncInit, 0); });
    
    /** User data localStorage key. */
    var userDataKey = 'imap_userData';
    
    /**
     * Check app authorization status.
     *
     *  @return boolean.
     */
    var isAuthorized = function() {
        // Assume app is authorized when cookie is set and user data exists in localStorage.
        return !!Cookies.get(authCookie) && !!window.localStorage.getItem(userDataKey);
    }
    
    /**
     * Ensure that the IMAP user is logged in & the app is authenticated before issuing calls.
     *
     *  @param callback     Function called at the end of the process.
     */     
    var authorize = function(callback) {
        if (isAuthorized()) {
            // Already signed in, call the callback function directly.
            callback('connected');
            return;
        }
        
        var info = {};
        
        // Callback execution flag. Prevents double calls.
        var called = false;
        
        // Register callback function on this window. This will be called from the popup window's callback page.
        window.imapAuthCallback = function(status, data) {
            // Save user data in local storage.
            window.localStorage.setItem(userDataKey, JSON.stringify(data));
            
            var detail = {};
            switch (status) {
                case 'connected':       detail = {authorized: true,     message: "Authorization granted"}; break;
                case 'not_authorized':  detail = {authorized: false,    message: "Not authorized"       }; break;
                case 'error':
                default:                detail = {authorized: false,    message: "Not connected"        }; break;
            }
            provider.dispatchEvent(new CustomEvent('auth', {detail: detail}));
            
            if (!called) { // Protect against double calls.
                called = true;
                callback(status);
            }
        };
        
        // Open login window.
        var features = [
            "width=800",
            "height=600",
            "status=no",
            "resizable=yes",
            "toolbar=no",
            "menubar=no",
            "scrollbars=yes"];
        var win = window.open('imap/login', 'imap_login', features.join(","));
        
        // Monitor close event.
        var i = setInterval(function() {
            if (win.closed) {
                clearInterval(i);
                setTimeout(function(){ 
                    if (!called) { // Protect against double calls.
                        called = true;
                        callback();
                    }
                }, 100);
            }
        }, 100);
    };
    
    
    /*
     *
     * Client interface.
     *
     */
     
    /**
     * Get main message body from string: 
     * - ignore lines starting with '>'
     * - join non-blank lines.
     *
     *  @param string   Raw message body string.
     *
     *  @return array of sentences.
     */
    var getMessageBody = function(string) {
        // Ignore lines starting with '>'.
        var lines = string.split('\n').filter(function(e) {return !e.match(/^>/);});
        
        // Join non-blank lines.
        return lines.join('\n').split(/\n(?:\s*\n)+/);
    }
    
    /**
     * Get image data URI from base64url string.
     *
     *  @param data     Base64url string.
     *  @param type     MIME type.
     *
     *  @return the image data URI.
     */
    var getImageUri = function(data, type) {
        // Gmail API calls use the base64url encoding, so convert chars 62-63 from -_ to +/.
        return 'data:' + type + ';base64,' + data.replace(/-/g,'+').replace(/_/g,'/');
    }
    
    /**
     * Request authorization from IMAP.
     *
     *  @param callback     Function called with content info.
     */ 
    provider.authorize = function(callback) {
        var info = {};
        authorize(function(status) {
            if (status == 'connected') {
                info.success = true;
                info.message = "Authorization granted";
            } else {
                info.success = false;
                switch (status) {
                    case 'unknown':         info.message = "User not logged in";    break;
                    case 'not_authorized':  info.message = "Authorization denied";  break;
                    default:                info.message = "Authorization error";   break;
                }
            }
            callback(info);
        });
    };
    
    /**
     * Get the lower bound for date ranges.
     * Useful when selecting a random window in a potentially large range (e.g. "All time").
     *
     * We use the user account creation date as the lower bound for date range. This data is
     * readily available after authentication.
     *
     *  @param callback     Called with either date upon success or a falsy value upon failure.
     */
    provider.getMinDate = function(callback) {
        authorize(function(status) {
            if (status == 'connected') {
                try {
                    // Return oldest message creation date.
                    $.getJSON('imap/oldest')
                        .done(function(data, textStatus, jqXHR) {
                            // Done!
                            callback(new Date(data));
                        })
                        .always(function() {
                            if (!isAuthorized()) {
                                // Lost authorization.
                                provider.dispatchEvent(new CustomEvent('auth', {detail: {message: "Not connected", authorized: false}}));
                            }
                        });
                } catch (e) {
                    // Failure.
                    callback();
                }
            } else {
                // Failure.
                callback();
            }
        });
    }
    
    /**
     * Fetch & scrape IMAP content. We get the following info:
     *
     *  - Subject line.
     *  - Textual body (not HTML).
     *  - Embedded images.
     *
     *  @param options          Options object.
     *  @param options.since    Minimum date.
     *  @param options.until    Maximum date.
     *  @param callback         Function called with content info.
     */ 
    provider.fetch = function(options, callback) {
        var info = {success: false};
        authorize(function(status) {
            if (status == 'connected') {
                // Get user data from localStorage.
                var userData = JSON.parse(window.localStorage.getItem(userDataKey));
                
                info.success = true;
                
                // Meta info.
                info.id = userData.id;
                info.url = userData.url;
                info.label = userData.username;
                
                // Fixed fields.

                // - Title = name.
                info.title = userData.username;
                
                // - Vendor = hostname.
                info.vendor = userData.host;
                
                // Sentences.
                info.sentences = [];
                
                // Images.
                info.images = [];
                
                // Issue Ajax call for messages. Error conditions are handled by the global error handler.
                var params = {};
                if (options.since) {
                    params.since = getTimestampFromDate(options.since);
                }
                if (options.until) {
                    params.until = getTimestampFromDate(options.until);
                }
                $.getJSON('imap/messages', params)
                .done(function(messages, textStatus, jqXHR) {
                    // - Price = number of messages.
                    info.price = messages.length.toString();
                
                    // Extract sentences from subjects and  bodies.
                    for (var i = 0; i < messages.length; i++) {
                        var message = messages[i];
                        if (message.subject) {
                            var sentences = splitSentences(message.subject);
                            info.sentences.push.apply(info.sentences, sentences);
                        }
                        var parts = message.parts;
                        if (parts) {
                            for (var j = 0; j < parts.length; j++) {
                                var part = parts[j];
                                switch (part.mimeType) {
                                    case 'text/plain': {
                                        // Message body.
                                        var body = getMessageBody(part.data);
                                        for (var k = 0; k < body.length; k++) {
                                            var sentences = splitSentences(body[k]);
                                            info.sentences.push.apply(info.sentences, sentences);
                                        }
                                        break;
                                    }
                                        
                                    default:
                                        if (part.mimeType.match(/^image\//)) {
                                            // Attached image.
                                            info.images.push(getImageUri(part.data, part.mimeType));
                                        }
                                }
                            }
                        }
                    }
                    
                    // Done!
                    callback(info);
                })
                .always(function() {
                    if (!isAuthorized()) {
                        // Lost authorization.
                        provider.dispatchEvent(new CustomEvent('auth', {detail: {message: "Not connected", authorized: false}}));
                    }
                });
            } else {
                // Can't issue API calls.
                switch (status) {
                    case 'unknown':         info.error = "User not logged into IMAP";       break;
                    case 'not_authorized':  info.error = "Authorization denied";            break;
                    default:                info.error = "Authorization error";             break;
                }
                callback(info);
            }
        });
    };
    
})(providers);
