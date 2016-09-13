/*
 *
 * Twitter scraping functions.
 *
 */

(function(providers) {
    /*
     *
     * Provider metadata (both server & client).
     *
     */
    var provider = new Provider("Twitter", /*TODO remove*/ /^$/);
    provider.hasDate = true;
    providers[provider.name] = provider;
        
    /** Request token cookie name. */
    var reqCookie = 'twitter_req';
        
    /** Authorization/access cookie name. */
    var authCookie = 'twitter_auth';
    
    /** User data cookie name. */
    var userCookie = 'twitter_user';
    
    if (typeof(exports) !== 'undefined') {
        /*
         *
         * Interface with the Twitter REST API (server only).
         *
         * App URL: https://apps.twitter.com/app/12825684/show
         *
         */
         
        var swig = require('swig');
        var twitterAPI = require('node-twitter-api');
        var cookieParser = require('cookie-parser');
        var crypto = require('crypto');
        
        /** API and session keys stored on server. MUST BE KEPT SECRET!!! */
        var twitterConfig;
        try {
            twitterConfig = require('../config/twitter.local.json');
        } catch (e) {
            twitterConfig = require('../config/twitter.json');
        }
        var twitter = new twitterAPI(twitterConfig);

        /**
         * callbackPageTpl
         * 
         * Template file for callback page.
         */
        var callbackPageTpl = swig.compileFile(__dirname + '/twitter_callback.html');

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
            res.clearCookie(reqCookie);
            res.clearCookie(authCookie);
            var code;
            switch (status) {
                case 'not_authorized':  code = 401; break;
                default:                code = 400; break;
            }
            return res.status(code).send(callbackPageTpl({status: status}));
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
            var cipher = crypto.createCipher('aes192', twitterConfig.cookiePassword);
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
            var decipher = crypto.createDecipher('aes192', twitterConfig.cookiePassword);
            var decrypted = decipher.update(string, 'base64', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        };
        
        /**
         * Define Twitter-specific routes.
         *
         *  @param app  The Express router instance.
         */
        provider.initRoutes = function(app) {
            /**
             * /twitter/auth
             *
             * Redirect to the Twitter authentication page.
             */
            app.get('/twitter/auth', function(req, res) {
                // Step 1: Get request token.
                twitter.getRequestToken(function(error, requestToken, requestTokenSecret, results){
                    if (error) {
                        return authError(res, "Error getting Twitter OAuth request token : " + JSON.stringify(error), 'error');
                    }
                    
                    // Store requestToken and requestTokenSecret in request cookie.
                    var requestData = {requestToken: requestToken, requestTokenSecret: requestTokenSecret};
                    res.cookie(reqCookie, encrypt(JSON.stringify(requestData)), {signed: true});
                    
                    // Redirect to auth window.
                    res.redirect(twitter.getAuthUrl(requestToken));
                });
            });
            
            /**
             * /twitter/callback
             *
             * Callback for the authentication window.
             */
            app.get('/twitter/callback', function(req, res) {
                // Generic error handler.
                if (req.query.denied) {
                    return authError(res, "Twitter OAuth Access denied", 'not_authorized');
                }
                
                // Get requestToken & requestTokenSecret from request cookie.
                var requestData;
                try {
                    requestData = JSON.parse(decrypt(req.signedCookies[reqCookie]));
                } catch (e) {
                    // Missing or misformed cookie.
                    return authError(res, "Missing cookie", 'error');
                }
                if (requestData.requestToken != req.query.oauth_token) {
                    // Bad token.
                    return authError(res, "Bad token", 'not_authorized');
                }

                // Step 2: Get access token.
                twitter.getAccessToken(requestData.requestToken, requestData.requestTokenSecret, req.query.oauth_verifier, function(error, accessToken, accessTokenSecret, results) {
                    if (error) {
                        return authError(res, "Error getting Twitter OAuth access token : " + JSON.stringify(error), 'error');
                    }
                    
                    // Step 3: Verify credentials.
                    twitter.verifyCredentials(accessToken, accessTokenSecret, {}, function(error, data, response) {
                        if (error) {
                            return authError(res, "Error verifying Twitter credentials : " + JSON.stringify(error), 'not_authorized');
                        }
                        
                        // Success!
                        console.log("Twitter user authenticated", data["screen_name"]);
                        
                        // Clear request cookie.
                        res.clearCookie(reqCookie);
                        
                        // Store accessToken and accessTokenSecret in authorization cookie.
                        var accessData = {accessToken: accessToken, accessTokenSecret: accessTokenSecret};
                        res.cookie(authCookie, encrypt(JSON.stringify(accessData)), {signed: true});
                        
                        // Store user data in plain cookie. Only keep things necessary on the server side to limit cookie size.
                        var userData = {id: data.id, screen_name: data.screen_name};
                        res.cookie(userCookie, JSON.stringify(userData));
                        
                        return res.send(callbackPageTpl({status: 'connected', data: JSON.stringify(data)}));
                    });
                });
            });
     
            /** Maximum number of tweets to fetch. */
            var maxTweets = 200;
            
            /**
             * /twitter/tweets?dateRange={dateRange}
             *
             * Get tweets for the current user.
             *
             *  @param dateRange    Date range for tweets, takes any of the following values:
             *                          - undefined or empty: no range
             *                          - 1d: past day
             *                          - 1w: past week
             *                          - 1m: past month
             *                          - 1y: past year
             */
            app.get('/twitter/tweets', function(req, res) {
                var dateRange = req.query.dateRange;
 
                // Get accessToken, accessTokenSecret & user data from cookie.
                var accessData, userData;
                try {
                    accessData = JSON.parse(decrypt(req.signedCookies[authCookie]));
                    userData = JSON.parse(req.cookies[userCookie]);
                } catch (e) {
                    // Missing or misformed cookie.
                    return authError(res, "Missing cookie", 'error');
                }
        
                // For date range we'll have to scan tweet lists manually.
                var since = new Date();
                switch (dateRange) {
                    case '1d':  since.setDate(since.getDate()-1);           break;
                    case '1w':  since.setDate(since.getDate()-7);           break;
                    case '1m':  since.setMonth(since.getMonth()-1);         break;
                    case '1y':  since.setFullYear(since.getFullYear()-1);   break;
                    default:    since = undefined;
                }
                twitter.getTimeline(
                    'user', 
                    {
                        screen_name: userData.screen_name, 
                        count: maxTweets, 
                        trim_user: true, 
                        exclude_replies: true, 
                        include_rts: false
                    }, 
                    accessData.accessToken, accessData.accessTokenSecret, 
                    function(error, data, response) {
                        if (error) {
                            return authError(res, "Error getting tweets : " + JSON.stringify(error), 'error');
                        }

                        if (since) {
                            // Return tweets past the time limit.
                            var results = [];
                            for (var i = 0; i < data.length; i++) {
                                var tweet = data[i];
                                try {
                                    if (new Date(tweet.created_at) >= since) {
                                        results.push(tweet);
                                    }
                                } catch (e) {}
                            }
                            return res.send(results);
                        } else {
                            // Return complete list.
                            return res.send(data);
                        }
                        
                    }
                );
            });
        };
        return;
    }
    
    
    /*
     *
     * Interface with the Twitter server endpoints (client only).
     *
     */
    
    // No remote API to load as everything is here, but we have to signal the 'loaded' event anyway once everything is ready.
    window.twAsyncInit = function() {
        console.debug("Twitter API ready");

        if (isAuthorized()) {
            // Issue auth event when already signed in.
            provider.dispatchEvent(new CustomEvent('auth', {detail: {message: "Signed in", authorized: true}}));
        }
        
        // Done! Send loaded event to all listeners.
        provider.dispatchEvent(new CustomEvent('loaded', {detail: {message: "API loaded"}}));
    };
    $(function() { window.setTimeout(twAsyncInit, 0); });
    
    /** User data localStorage key. */
    var userDataKey = 'twitter_userData';
    
    /**
     * Check app authorization status.
     *
     *  @return boolean.
     */
    var isAuthorized = function() {
        // Assume app is authorized when cookie is set.
        return !!Cookies.get(authCookie);
    }
    
    /**
     * Ensure that the Twitter user is logged & the app is authenticated before issuing calls.
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
        window.twAuthCallback = function(status, data) {
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
        
        // Open authorization window.
        var features = [
            "width=800",
            "height=600",
            "status=no",
            "resizable=yes",
            "toolbar=no",
            "menubar=no",
            "scrollbars=yes"];
        var win = window.open('twitter/auth', 'twitter_auth', features.join(","));
        
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
     * Request authorization from Twitter.
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
     * Fetch & scrape Twitter content. We get the following info:
     *
     *  - Profile info.
     *  - Tweet texts & photos.
     *
     *  @param options      Options object:
     *                      - dateRange: Date range for messages, takes any of the following values:
     *                          * undefined or empty: no range
     *                          * 1d: past day
     *                          * 1w: past week
     *                          * 1m: past month
     *                          * 1y: past year
     *  @param callback     Function called with content info.
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
                info.url = "https://twitter.com/" + userData.screen_name;
                info.label = userData.name;
                
                // Fixed fields.

                // - Title = name.
                info.title = userData.name;
                
                // - Vendor = location.
                info.vendor = userData.location||'';
                
                // - Price = number of tweets.
                info.price = userData.statuses_count.toString();
                
                // Sentences.
                info.sentences = [];
                
                // - Description.
                if (userData.description) {
                    var sentences = splitSentences(userData.description);
                    for (var j = 0; j < sentences.length; j++) {
                        info.sentences.push(sentences[j]);
                    }
                }
                
                // Images.
                info.images = [];
                
                // - Profile images.
                if (userData.profile_image_url_https) {
                    info.images.push(userData.profile_image_url_https);
                }
                
                // Issue Ajax call for tweets. Error conditions are handled by the global error handler.
                $.getJSON('twitter/tweets', options)
                .done(function(data, textStatus, jqXHR) {
                    for (var i = 0; i < data.length; i++) {
                        var tweet = data[i];
                        
                        // Tweet text.
                        var sentences = splitSentences(tweet.text);
                        for (var j = 0; j < sentences.length; j++) {
                            info.sentences.push(sentences[j]);
                        }
                        
                        // Tweet images.
                        if (tweet.entities && tweet.entities.media) {
                            for (var j = 0; j < tweet.entities.media.length; j++) {
                                var media = tweet.entities.media[j];
                                if (media.type == 'photo') {
                                    info.images.push(media.media_url);
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
                    case 'unknown':         info.error = "User not logged into Twitter";   break;
                    case 'not_authorized':  info.error = "Authorization denied";            break;
                    default:                info.error = "Authorization error";             break;
                }
                callback(info);
            }
        });
    };
    
})(providers);
