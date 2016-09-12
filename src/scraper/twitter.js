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
         * Define Twitter-specific routes.
         *
         *  @param app  The Express router instance.
         */
        provider.initRoutes = function(app) {
            /**
             * /twitter_auth
             *
             * Redirect to the Twitter authentication page.
             */
            app.get('/twitter_auth', function(req, res) {
                // Step 1: Get request token.
                twitter.getRequestToken(function(error, requestToken, requestTokenSecret, results){
                    if (error) {
                        console.log("Error getting Twitter OAuth request token : " + error);
                        return res.status(400).send(callbackPageTpl({status: 'error'}));
                    }
                    
                    // Store requestToken and requestTokenSecret in cookie. TODO encrypt?
                    var cookie = JSON.stringify({requestToken: requestToken, requestTokenSecret: requestTokenSecret});
                    res.cookie(twitterConfig.cookie, cookie, {signed: true});
                    
                    // Redirect to auth window.
                    res.redirect(twitter.getAuthUrl(requestToken));
                });
            });
            
            /**
             * /twitter_callback
             *
             * Callback for the authentication window.
             */
            app.get('/twitter_callback', function(req, res) {
                if (req.query.denied) {
                    console.log("Twitter OAuth Access denied");
                    return res.status(401).send(callbackPageTpl({status: 'not_authorized'}));
                }
                
                // Get requestToken & requestTokenSecret from cookie.
                var cookie;
                try {
                    cookie = JSON.parse(req.signedCookies['twitter_oauth']);
                } catch (e) {
                    // Missing or misformed cookie.
                    return res.status(400).send(callbackPageTpl({status: 'error'}));
                }
                if (cookie.requestToken != req.query.oauth_token) {
                    // Bad token.
                    console.log(cookie, req.query);
                    return res.status(401).send(callbackPageTpl({status: 'not_authorized'}));
                }

                // Step 2: Get access token.
                twitter.getAccessToken(cookie.requestToken, cookie.requestTokenSecret, req.query.oauth_verifier, function(error, accessToken, accessTokenSecret, results) {
                    if (error) {
                        console.log("Error getting Twitter OAuth access token : " + error);
                        return res.status(400).send(callbackPageTpl({status: 'error'}));
                    }
                    
                    // Step 3: Verify credentials.
                    twitter.verifyCredentials(accessToken, accessTokenSecret, {}, function(error, data, response) {
                        if (error) {
                            console.log("Error verifying Twitter credentials : " + error);
                            return res.status(401).send(callbackPageTpl({status: 'not_authorized'}));
                        }
                        
                        // Store accessToken and accessTokenSecret in cookie. TODO encrypt?
                        var cookie = JSON.stringify({accessToken: accessToken, accessTokenSecret: accessTokenSecret});
                        res.cookie(twitterConfig.cookie, cookie, {signed: true});
                        
                        // Success!
                        console.log("Twitter user authenticated", data["screen_name"]);
                        return res.send(callbackPageTpl({status: 'connected'}));
                    });
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

        //TODO check authorize status
        
        // Done! Send loaded event to all listeners.
        provider.dispatchEvent(new CustomEvent('loaded', {detail: {message: "API loaded"}}));
    };
    $(function() { window.setTimeout(twAsyncInit, 0); });
    
    /**
     * Ensure that the Twitter user is logged & the app is authenticated before issuing calls.
     *
     *  @param callback     Function called at the end of the process.
     */     
    var authorize = function(callback) {
        //TODO check authorize status
        
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
        var win = window.open('twitter_auth', 'twitter_auth', features.join(","));
        
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
     *  - Profile bio TODO
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
        //TODO
        info.success = false;
        info.message = "TODO";
        callback(info);
    };
    
})(providers);
