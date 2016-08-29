/*
 *
 * Facebook scraping functions.
 *
 */

(function(providers) {
    /*
     *
     * Provider metadata (both server & client).
     *
     */
    var provider = {
        name: "Facebook",
        
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
     * Interface with the Facebook web API (client only).
     *
     * App URL: https://developers.facebook.com/apps/112125819241682/dashboard/
     *
     */
    
    // Facebook settings.
    var APP_ID = '112125819241682';
    var APP_SCOPES = 'public_profile,user_about_me,user_birthday,user_education_history,user_hometown,user_location,user_photos,user_posts,user_work_history,user_religion_politics';
    
    // Load the SDK asynchronously
    window.fbAsyncInit = function() {
        console.log("Facebook API loaded");
        FB.init({
            appId   : APP_ID,
            cookie  : true,
            status  : true,
            xfbml   : false,
            version : 'v2.7'
        });
    };
    (function(d, s, id) {
        var js, fjs = d.getElementsByTagName(s)[0];
        if (d.getElementById(id)) return;
        js = d.createElement(s); js.id = id;
        js.src = "//connect.facebook.net/en_US/sdk.js";
        fjs.parentNode.insertBefore(js, fjs);
    }(document, 'script', 'facebook-jssdk'));
    
    /**
     * Ensure that the Facebook user is logged & the app is authenticated before issuing calls.
     *
     *  @parap callback     Function called with auth result.
     */     
    var authorize = function(callback) {
        FB.getLoginStatus(function(response) {
            if (response.status == "connected") {
                // Already connected, call the callback function directly.
                callback(response);
            } else {
                // Pass the callback to the login call.
                FB.login(callback, {scope: APP_SCOPES});
            }
        });
    };
    
    var getUserInfo = function(callback) {
        throw "TODO";
    };
    var getUserWork = function(callback) {
        throw "TODO";
    };
    var getUserEducation = function(callback) {
        throw "TODO";
    };
    var getUserPhotos = function(callback) {
        throw "TODO";
    };
    
    /**
     * Get posts from Facebook user timeline.
     *
     *  @param min          Minimum number of posts to get.
     *  @param callback     Function called with results.
     */
    var getUserPosts = function(min, callback) {
        // Get data from current result page, and continue to next page if needed.
        var extractPage = function(response, info, callback) {
            // Extract nonempty messages.
            for (var i = 0; i < response.data.length; i++) {
                var post = response.data[i];
                if (post.message) {
                    info.posts.push(post.message);
                }
            }
            if (info.posts.length < minPosts && response.paging && response.paging.next) {
                // Need more posts, issue request for next page.
                FB.api(response.paging.next, function(response) {
                    if (response.error) {
                        // Stop there.
                        callback(info);
                    } else {
                        // On to next page.
                        extractPage(response, info, callback);
                    }
                });
            } else {
                // Done!
                callback(info);
            }
        };
        
        // Issue main request.
        FB.api('/me/posts', {fields: 'message'}, function(response) {
            var info = {};
            if (response.error) {
                // Pass error to callback.
                info.success = false;
                info.error = response.error.message;
                callback(info);
            } else {
                // Extract posts.
                info.success = true;
                info.posts = [];
                extractPage(response, info, callback);
            }
        });
    }
    
    
    /*
     *
     * Data scraping (client only).
     *
     */
     
    /** Minimum number of posts to fetch. */
    var minPosts = 50;
    
    /**
     * Fetch & scrape Facebook content. We get the following info:
     *
     *  - Basic profile info TODO
     *  - Work & education TODO
     *  - Photos TODO
     *  - Posts
     *
     *  @param callback     Function called with content info.
     */ 
    provider.fetch = function(callback) {
        var info = {success: false};
        authorize(function(response) {
            if (response.status == "connected") {
                // Get user posts & extract sentences.
                info.sentences = [];
                getUserPosts(minPosts, function(infoPosts) {
                    if (infoPosts.posts) {
                        for (var i = 0; i < infoPosts.posts.length; i++) {
                            var sentences = splitSentences(infoPosts.posts[i]);
                            for (var j = 0; j < sentences.length; j++) {
                                info.sentences.push(sentences[j]);
                            }
                        }
                    }
                    
                    // Done!
                    info.success = true;
                    callback(info);
                });
            } else {
                // Can't issue API calls.
                console.error(response);
                switch (response.status) {
                    case "unknown":         info.error = "User not logged into Facebook";   break;
                    case "not_authorized":  info.error = "Authorization denied";            break;
                    default:                info.error = "Authorization error";             break;
                }
                callback(info);
            }
        });
    };
    
})(providers);
