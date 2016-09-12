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
        
    /** Authentication cookie name. */
    var authCookie = 'twitter_auth';
    
    /** User data cookie name. */
    var userCookie = 'twitter_user';
    
    if (typeof(exports) !== 'undefined') {
        // Running on server.
        var swig = require('swig');
        var twitterAPI = require('node-twitter-api');
        var cookieParser = require('cookie-parser');

        /**
         * callbackPageTpl()
         * 
         * Template file for callback page.
         */
        var callbackPageTpl = swig.compileFile(__dirname + '/twitter_callback.html');

        /** API and session keys stored on server. MUST BE KEPT SECRET!!! */
        var twitterConfig = require('../config/twitter.json');
        var twitter = new twitterAPI(twitterConfig);
        
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
                case 'not_authorized':  code = 401; break;
                default:                code = 400; break;
            }
            return res.status(code).send(callbackPageTpl({status: status}));
        }
        
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
                        return authError(res, "Error getting Twitter OAuth request token : " + error, 'error');
                    }
                    
                    // Store requestToken and requestTokenSecret in signed cookie. TODO encrypt?
                    var requestData = {requestToken: requestToken, requestTokenSecret: requestTokenSecret};
                    res.cookie(authCookie, JSON.stringify(requestData), {signed: true});
                    
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
                
                // Get requestToken & requestTokenSecret from cookie.
                var requestData;
                try {
                    requestData = JSON.parse(req.signedCookies[authCookie]);
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
                        return authError(res, "Error getting Twitter OAuth access token : " + error, 'error');
                    }
                    
                    // Step 3: Verify credentials.
                    twitter.verifyCredentials(accessToken, accessTokenSecret, {}, function(error, data, response) {
                        if (error) {
                            return authError(res, "Error verifying Twitter credentials : " + error, 'not_authorized');
                        }
                        
                        // Success!
                        console.log("Twitter user authenticated", data["screen_name"]);
                        
                        // Store accessToken and accessTokenSecret in signed cookie. TODO encrypt?
                        var accessData = {accessToken: accessToken, accessTokenSecret: accessTokenSecret};
                        res.cookie(authCookie, JSON.stringify(accessData), {signed: true});
                        
                        // Store user data in plain cookie.
                        res.cookie(userCookie, JSON.stringify(data));
                        
                        return res.send(callbackPageTpl({status: 'connected'}));
                    });
                });
            });
                
            /**
             * /twitter/statuses?dateRange={dateRange}
             *
             * Get statuses for the current user.
             *
             *  @param dateRange    Date range for messages, takes any of the following values:
             *                          - undefined or empty: no range
             *                          - 1d: past day
             *                          - 1w: past week
             *                          - 1m: past month
             *                          - 1y: past year
             */
            app.get('/twitter/statuses', function(req, res) {
                var dateRange = req.query.dateRange;
                console.log(dateRange);
 
                // Get accessToken, accessTokenSecret & user data from cookie.
                var accessData, userData;
                try {
                    accessData = JSON.parse(req.signedCookies[authCookie]);
                    userData = JSON.parse(req.cookies[userCookie]);
                } catch (e) {
                    // Missing or misformed cookie.
                    return authError(res, "Missing cookie", 'error');
                }
                
                // TODO dateRange handling
                twitter.getTimeline('user', {screen_name: userData.screen_name, count: 200, trim_user: true, exclude_replies: true, include_rts: false}, accessData.accessToken, accessData.accessTokenSecret, function(error, data, response) {
                    //TODO error handling
                    return res.send(data);
                });
            });
        };
        return;
    }
    
    
    /*
     *
     * Interface with the Twitter server endpoints (client only).
     *
     * App URL: https://apps.twitter.com/app/12825684/show
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
        window.twAuthCallback = function(status) {
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
     *  - Tweets TODO
     *  - Photos TODO
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
                // Get user data from cookie.
                var userData = Cookies.getJSON(userCookie);
                
                // Issue Ajax call. Error conditions are handled by the global error handler.
                $.getJSON('twitter/statuses', options)
                .done(function(data, textStatus, jqXHR) {
                    info.success = true;
                    
                    // Main info.
                    info.id = userData.id;
                    info.url = "https://twitter.com/" + userData.screen_name;
                    info.label = userData.name;
                    
                    // Sentences.
                    info.sentences = [];
                    
                    // - Title = name.
                    info.sentences.push(userData.name);
                    
                    // - Subtitle = location.
                    info.sentences.push(userData.location||'');
                    
                    // - Price = number of tweets.
                    info.sentences.push(userData.statuses_count.toString());
                    
                    // - Description.
                    if (userData.description) {
                        var sentences = splitSentences(userData.description);
                        for (var j = 0; j < sentences.length; j++) {
                            info.sentences.push(sentences[j]);
                        }
                    }
                    
                    // - Status texts.
                    for (var i = 0; i < data.length; i++) {
                        var status = data[i];
                        var sentences = splitSentences(status.text);
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
                    
                    // - Status images TODO.
                    
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
