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
    var provider = new Provider("Facebook", /*TODO remove*/ /^$/);
    provider.hasDate = true;
    providers[provider.name] = provider;
    
    if (typeof(exports) !== 'undefined') {
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
    var APP_SCOPES = 'public_profile,user_hometown,user_location,user_photos,user_friends,user_posts';
    
    // Load the SDK asynchronously.
    window.fbAsyncInit = function() {
        console.debug("Facebook API loaded");
        
        FB.init({
            appId   : APP_ID,
            cookie  : true,
            status  : true,
            xfbml   : false,
            version : 'v2.7'
        });
        
        // Route FB's login status events through our own interface.
        FB.Event.subscribe('auth.statusChange', function(response) {
            var detail = {};
            switch (response.status) {
                case 'connected':       detail = {authorized: true,     message: "Authorization granted"}; break;
                case 'not_authorized':  detail = {authorized: false,    message: "Not authorized"       }; break;
                case 'unknown':
                default:                detail = {authorized: false,    message: "Not connected"        }; break;
            }
            provider.dispatchEvent(new CustomEvent('auth', {detail: detail}));
        });
        
        // Done! Send loaded event to all listeners.
        provider.dispatchEvent(new CustomEvent('loaded', {detail: {message: "API loaded"}}));
    };
    $(function() { // Avoid race condition during initialization by executing the init code when document is ready.
        (function(d, s, id) {
            var js, fjs = d.getElementsByTagName(s)[0];
            if (d.getElementById(id)) return;
            js = d.createElement(s); js.id = id;
            js.src = "//connect.facebook.net/en_US/sdk.js";
            fjs.parentNode.insertBefore(js, fjs);
        }(document, 'script', 'facebook-jssdk'));
    });

    /**
     * Ensure that the Facebook user is logged & the app is authenticated before issuing calls.
     *
     *  @param callback     Function called with auth result.
     */     
    var authorize = function(callback) {
        FB.getLoginStatus(function(response) {
            if (response.status == 'connected') {
                // Already connected, call the callback function directly.
                callback(response);
            } else {
                // Pass the callback to the login call.
                FB.login(callback, {scope: APP_SCOPES});
            }
        });
    };
    
    /** Minimum number of non-empty posts to return. */
    var minPosts = 100;
     
    /** Maximum number of posts to fetch at once. */
    var maxPosts = 250;
    
    /**
     * Get posts from Facebook user timeline.
     *
     *  @param options          Options object.
     *  @param options.since    Minimum date.
     *  @param options.until    Maximum date.
     *  @param callback         Function called with results.
     *
     *  @see provider.fetch()
     */
    var getUserPosts = function(options, callback) {
        // Parameters passed to /me/posts.
        var params = '?limit=' + maxPosts;
        
        // For date range we use time-based pagination with 'since' & 'until' parameters:
        //  https://developers.facebook.com/docs/graph-api/using-graph-api#time
        if (options.since) {
            params += '&since=' + getTimestamp(options.since);
        }
        if (options.until) {
            params += '&until=' + getTimestamp(options.until);
        }
        
        // Get data from current result page, and continue to next page if needed.
        var extractPage = function(response, info, callback) {
            // Extract nonempty messages and pictures.
            for (var i = 0; i < response.data.length; i++) {
                var post = response.data[i];
                if (post.message || post.picture) {
                    info.posts.push(post);
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
        FB.api('/me/feed' + params, {fields: 'message,picture'}, function(response) {
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
     * Client interface.
     *
     */
     
    /**
     * Request authorization from Facebook.
     *
     *  @param callback     Function called with content info.
     */ 
    provider.authorize = function(callback) {
        var info = {};
        authorize(function(response) {
            if (response.status == 'connected') {
                info.success = true;
                info.message = "Authorization granted";
            } else {
                info.success = false;
                switch (response.status) {
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
     * There is no direct way to get the oldest post in a Facebook account so we do it iteratively
     * using time-based pagination:
     *
     *      https://developers.facebook.com/docs/graph-api/using-graph-api#time
     *
     *  @param callback     Called with either date upon success or a falsy value upon failure.
     */
    provider.getMinDate = function(callback) {
        // General failure handler.
        var failure = function() {
            callback();
        };
        
        // Find first year with at least one post: build batch with all year ranges in parallel.
        var minYear = 2004; // Facebook year of birth.
        var now = new Date();
        var years = [];
        for (var y = minYear; y <= now.getFullYear(); y++) {
            // Date range for given year.
            var since = new Date(y, 0, 1);
            var until = new Date(y+1, 0, 1);
            years.push({
                method: 'GET', 
                relative_url: 'me/posts?fields=created_time&since=' + getTimestamp(since) + '&until=' + getTimestamp(until) + '&limit=1'
            });
        }
        FB.api('/', 'POST', {batch: years}, function (response) {
            // Find successful batch response with lowest year. Responses are in request order.
            for (var i = 0; i < response.length; i++) {
                try {
                    var body = JSON.parse(response[i].body);
                    if (!body.data || !body.data.length) continue;
                    
                    // Found non-empty result, now find oldest post year.
                    var year = new Date(body.data[body.data.length-1].created_time).getFullYear();
                    
                    // Now find first month in year. Use the same technique here.
                    var months = [];
                    for (var m = 0; m <= 12; m++) {
                        var since = new Date(year, m, 1);
                        var until = new Date(year, m+1, 1);
                        months.push({
                            method: 'GET', 
                            relative_url: 'me/posts?fields=created_time&since=' + getTimestamp(since) + '&until=' + getTimestamp(until) + '&limit=1'
                        });
                    }
                    FB.api('/', 'POST', {batch: months}, function (response) {
                        // Find successful batch response with lowest month. Responses are in request order.
                        for (var i = 0; i < response.length; i++) {
                            try {
                                var body = JSON.parse(response[i].body);
                                if (!body.data || !body.data.length) continue;
                        
                                // Found non-empty result, now find oldest post month.
                                var month = new Date(body.data[body.data.length-1].created_time).getMonth();
                    
                                // Year+month is good enough so stop there.
                                callback(new Date(year, month, 1));
                                return;
                            } catch (e) {console.error(e);}
                        }
                        
                        failure();
                    });
                    return;
                } catch (e) {console.error(e);}
            }
            
            failure();
        });
    };
    
    /**
     * Fetch & scrape Facebook content. We get the following info:
     *
     *  - Profile info.
     *  - Post texts & photos.
     *
     *  @param options          Options object.
     *  @param options.since    Minimum date.
     *  @param options.until    Maximum date.
     *  @param callback         Function called with content info.
     */ 
    provider.fetch = function(options, callback) {
        var info = {success: false};
        
        // Generic FB API error handler.
        var apiError = function(response) {
            console.error(response.error.message);
            info.success = false;
            info.error = response.error.message;
            callback(info);
        };
        
        // Handle parallel requests.
        var nbRequests = 0;
        
        authorize(function(response) {
            if (response.status == 'connected') {
                // Get main profile info.
                FB.api('/me', {fields: 'id,link,name,picture,location,hometown,age_range'}, function(response) {
                    if (response.error) {
                        return apiError(response);
                    }
                    console.log(response);
                    
                    info.success = true;
                    
                    // Meta info.
                    info.id = response.id;
                    info.url = response.link;
                    info.label = response.name;
                    
                    // Fixed fields.

                    // - Title = name.
                    info.title = response.name;
                    
                    // - Vendor = location or hometown.
                    info.vendor = (response.location?response.location.name:response.hometown?response.hometown.name:'');
                    
                    // - Price = number of friends.
                    nbRequests++;
                    FB.api('/me/friends', {limit: 0}, function(response) {
                        info.price = (response.summary?response.summary.total_count.toString():'');
                        
                        if (--nbRequests <= 0) {
                            callback(info);
                        }
                    });
                    
                    // Sentences.
                    info.sentences = [];
                    
                    // Images.
                    info.images = [];
                    
                    // - Profile images.
                    if (response.picture && response.picture.data && response.picture.data.url) {
                        info.images.push(response.picture.data.url);
                    }
                    
                    // User Posts.
                    nbRequests++;
                    getUserPosts(options, function(infoPosts) {
                        for (var i = 0; i < infoPosts.posts.length; i++) {
                            var post = infoPosts.posts[i];
                            
                            // Post text.
                            if (post.message) {
                                var sentences = splitSentences(post.message);
                                for (var j = 0; j < sentences.length; j++) {
                                    info.sentences.push(sentences[j]);
                                }
                            }
                        
                            // Post picture.
                            if (post.picture) {
                                info.images.push(post.picture);
                            }
                        }
                    
                        if (--nbRequests <= 0) {
                            callback(info);
                        }
                    });
                });
            } else {
                // Can't issue API calls.
                console.error(response);
                switch (response.status) {
                    case 'unknown':         info.error = "User not logged into Facebook";   break;
                    case 'not_authorized':  info.error = "Authorization denied";            break;
                    default:                info.error = "Authorization error";             break;
                }
                callback(info);
            }
        });
    };
    
})(providers);
