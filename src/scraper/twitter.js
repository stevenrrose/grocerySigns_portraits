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
         
        var request = require('request');
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
         * Twitter authentication URL. Don't use twitterAPI's getAuthUrl() as it uses the wrong domain (twitter.com 
         * instead of api.twitter.com), which makes the process fail on some clients. For example, Android will
         * close the popup and display the app chooser instead, so even if the user authenticates successfully the
         * app wouldn't know.
         */
        var authUrl = 'https://api.twitter.com/oauth/authenticate?oauth_token=';
        
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
                    return res.redirect(authUrl + requestToken);
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
             * /twitter/tweets?since={timestamp}&until={timestamp}
             *
             * Get tweets for the current user.
             *
             *  @param since    Minimum tweet timestamp.
             *  @param until    Maximum tweet timestamp.
             */
            app.get('/twitter/tweets', function(req, res) {
                var since = req.query.since;
                var until = req.query.until;
 
                // Get accessToken, accessTokenSecret & user data from cookie.
                var accessData, userData;
                try {
                    accessData = JSON.parse(decrypt(req.signedCookies[authCookie]));
                    userData = JSON.parse(req.cookies[userCookie]);
                } catch (e) {
                    // Missing or misformed cookie.
                    return authError(res, "Missing cookie", 'error');
                }
                
                // Main request.
                var params = {
                    screen_name: userData.screen_name, 
                    count: maxTweets, 
                    trim_user: true, 
                    exclude_replies: true, 
                    include_rts: false
                };
                var main = function() {
                    twitter.getTimeline(
                        'user', 
                        params,
                        accessData.accessToken, accessData.accessTokenSecret, 
                        function(error, data, response) {
                            if (error) {
                                return authError(res, "Error getting tweets : " + JSON.stringify(error), 'error');
                            }

                            var results = [];
                            for (var i = 0; i < data.length; i++) {
                                var tweet = data[i];
                                
                                // Filter out tweets outside the date range.
                                try {
                                    var date = getTimestamp(new Date(tweet.created_at));
                                    if (since && date < since) continue;
                                    if (until && date > until) continue;
                                    results.push(tweet);
                                } catch (e) {console.log(e)}
                            }
                            return res.send(results);
                            
                        }
                    );
                };
                
                if (until) {
                    /*
                     * The idiotic Twitter API doesn't provide search results past 7 days, only filtering by status ID ('since_id', 'max_id'):
                     *
                     *      https://dev.twitter.com/rest/public/timelines
                     *
                     * And it doesn't provide a way to get an ID from a date either. So we have to use a convoluted way to get this ID value.
                     * To do so, we use the Big Ben Clock twitter account (no kidding) because it posts tweets every hour. We use plain 
                     * old web scraping with the public Twitter search page then extracts the highest status ID (given as 'data-tweet-id'
                     * attributes on the web page).
                     */
                    var url = 'https://twitter.com/search?f=tweets&vertical=default&src=typd&q=from%3Abig_ben_clock%20until%3A' + until;
                    request(url, function (error, response, body) {
                        if (!error) {
                            // Find max status ID. Normally they are sorted in decreasing values but you never know.
                            var max = 0;
                            var re = /data-tweet-id="(.*?)"/g;
                            var match;
                            while (match = re.exec(body)) {
                                try {
                                    var id = Number.parseInt(match[1]);
                                    if (max < id) max = id;
                                } catch (e) {}
                            }
                            if (max) {
                                params.max_id = max;
                            }
                        }
                        
                        // Execute main request with the 'max_id' parameter above (if found).
                        main();
                    });
                } else {
                    // Execute main request directly.
                    main();
                }
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
        // Assume app is authorized when cookie is set and user data exists in localStorage.
        return !!Cookies.get(authCookie) && !!window.localStorage.getItem(userDataKey);
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
     * Get the lower bound for date ranges.
     * Useful when selecting a random window in a potentially large range (e.g. "All time").
     *
     * We use the user account creation date as the lower bound for date range. This data is
     * readily available after authentication.
     *
     *  @param callback     Called with either date upon success or a falsy value upon failure.
     */
    provider.getMinDate = function(callback) {
        try {
            // Get user data from localStorage.
            var userData = JSON.parse(window.localStorage.getItem(userDataKey));
            
            // Return account creation date.
            callback(new Date(userData.created_at));
        } catch (e) {
            // Failure.
            callback();
        }  
    }
    
    /**
     * Fetch & scrape Twitter content. We get the following info:
     *
     *  - Profile info.
     *  - Tweet texts & photos.
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
                info.url = 'https://twitter.com/intent/user?screen_name=' + userData.screen_name;
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
                var params = {};
                if (options.since) {
                    params.since = getTimestamp(options.since);
                }
                if (options.until) {
                    params.until = getTimestamp(options.until);
                }
                $.getJSON('twitter/tweets', params)
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
