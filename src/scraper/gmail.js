/*
 *
 * Gmail scraping functions.
 *
 */

(function(providers) {
    /*
     *
     * Provider metadata (both server & client).
     *
     */
    var provider = {
        name: "Gmail",
        
        /** Allowed URL pattern. */
        //TODO remove
        urlPattern: /^$/
    };
    providers[provider.name] = provider;
    
    if (typeof $ === 'undefined') {
        // Running on server, only metadata is needed.
        return;
    }
    
    
    /*
     *
     * Interface with the Gmail web API (client only).
     *
     */
    
    // Gmail settings.
    var CLIENT_ID = "612453794408-e72qm8av2gi1sa7s1tq36o2aio1ksfqa.apps.googleusercontent.com";
    var SCOPES = 'https://www.googleapis.com/auth/gmail.readonly';
    
    // Load the SDK asynchronously
    window.gmAsyncInit = function() {
        console.log("Google API loaded");
    };
    (function(d, s, id) {
        var js, fjs = d.getElementsByTagName(s)[0];
        if (d.getElementById(id)) return;
        js = d.createElement(s); js.id = id;
        js.src = "//apis.google.com/js/client.js?onload=gmAsyncInit";
        fjs.parentNode.insertBefore(js, fjs);
    }(document, 'script', 'gmail-jssdk'));
    
    /** Immediate mode flag for authorization. */
    var immediate = false;
    

    /**
     * Ensure that the Gmail user is logged & the app is authenticated before issuing calls.
     *
     *  @parap callback     Function called at the end of the process.
     */     
    var authorize = function(callback) {
        // Google gapi.auth.authorize() doesn't call our callback when the user closes the popup, and there is no built-in way to detect
        // popup window close events, so we have to use the trick described here: 
        //
        //      https://github.com/google/google-api-javascript-client/issues/25#issuecomment-76695596
        //
        // It involves hijacking the standard window.open function just before the API call, then periodically checking for the window's
        // 'closed' state. If closed, we cancel the promise returned by the call to gapi.auth.authorize(). We avoid race conditions by
        // doing so in a deferred event handler, so that the regular cancel mechanism has a chance to get triggered first if the user
        // denies authorization instead of closing the window.

        // The promise to cancel upon close.
        var promise;

        // window.open wrapper.
        (function(wrapped) {
            window.open = function() {
                // re-assign the original window.open after one usage
                window.open = wrapped;

                var win = wrapped.apply(this, arguments);
                var i = setInterval(function() {
                    if (win.closed) {
                        clearInterval(i);
                        // cancel has no effect when the promise is already resolved, e.g. by the success handler
                        // see http://docs.closure-library.googlecode.com/git/class_goog_Promise.html#goog.Promise.prototype.cancel
                        setTimeout(function(){ promise.cancel("closed"); }, 100);
                    }
                }, 100);
                return win;
            };
        })(window.open);

        // Issue call as usual.
        promise = gapi.auth.authorize({
            'client_id': CLIENT_ID,
            'scope': SCOPES,
            'immediate': immediate
        }).then(
            // FIXME immediate mode handling is probably suboptimal, we should only issue authorize calls upon failure
            function(response) { 
                immediate = true;   // Try immediate from now on.
                callback(response);
            },
            function(reason) { 
                immediate = false;  // Error, force popup display next time.
                callback({error: (reason && reason.message ? reason.message : "denied")}); 
            }
        );
    };
    
    
    /*
     *
     * Data scraping (client only).
     *
     */
     
    /**
     * Fetch & scrape Gmail content. We get the following info:
     *
     *  - Name, headline title, summary, .
     *  - Number of connections.
     *  - Locations, positions (current and past)
     *  - Profile images.
     *
     *  @param callback     Function called with content info.
     */ 
    provider.fetch = function(callback) {
        authorize(function(response) {
            if (response && !response.error) {
                //TODO
                console.error(response);
                var info = {};
                info.success = false;
                info.error = "TODO";
                callback(info);
            } else {
                // Can't issue API calls.
                console.error(response);
                var info = {};
                info.success = false;
                switch (response.error) {
                    case "closed":
                    case "denied":  info.error = "Authorization denied";    break;
                    default:        info.error = "Authorization error";     break;
                }
                callback(info);
            }
        });
    };
    
})(providers);
