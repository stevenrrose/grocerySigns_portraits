/*
 *
 * LinkedIn scraping functions.
 *
 */

(function(providers) {
    /*
     *
     * Provider metadata (both server & client).
     *
     */
    var provider = {
        name: "LinkedIn",
        
        /** Allowed URL pattern. */
        //TODO remove
        urlPattern: /^$/
    };
    providers["LinkedIn"] = provider;
    
    if (typeof $ === 'undefined') {
        // Running on server, only metadata is needed.
        return;
    }
    
    
    /*
     *
     * Interface with the LinkedIn web API (client only).
     *
     */
    
    // LinkedIn settings.
    var APP_ID = '787q99ukiatyi8';
    
    // Load the SDK asynchronously
    window.inAsyncInit = function() {
        console.log("LinkedIn SDK loaded");
    };
    (function(d, s, id) {
        var js, fjs = d.getElementsByTagName(s)[0];
        if (d.getElementById(id)) return;
        js = d.createElement(s); js.id = id;
        js.src = "//platform.linkedin.com/in.js";
        js.innerHTML = "api_key: " + APP_ID + "\nonLoad: inAsyncInit\nauthorize: yes\nlang: en_US";
        fjs.parentNode.insertBefore(js, fjs);
    }(document, 'script', 'linkedin-jssdk'));
    
    /**
     * Ensure that the LinkedIn user is logged & the app is authenticated before issuing calls.
     *
     *  @parap callback     Function called at the end of the process.
     */     
    var authorize = function(callback) {
        // LinkedIn IN.User.authorize() doesn't call our callback immediately upon failure (e.g. user closed the popup or refused to 
        // log in), so we have to use the following trick: 
        // - The SDK opens the login popup from an iframe that gets destroyed with the popup, so we have to check periodically that 
        //   the iframe still exists. There is no way to do otherwise (e.g. event) because of CORS restrictions.
        // - Callbacks passed to failed IN.User.authorize() calls are called eventually if the authorization succeeds later on, so we have 
        //   to protect them against double calls.
        
        // Callback execution flag. Prevents double calls.
        var called = false;
        
        // Authorization iframe monitoring script.
        var id = setInterval(function() {
 			var iframes = document.getElementsByTagName("iframe");
 			for (var i = 0; i < iframes.length; i++) {
 				if (iframes[i].src.match(/\.linkedin\.com\//)) {
                    // Authorization iframe still exists.
 					return;
 				}
 			}

            // Authorization iframe no longer exists, this means that the popup was closed one way or another (success or failure).
            // Stop monitoring and call the callback function.
 			clearInterval(id);
 			if (!called) {
                called = true;
                callback();
            }
 		}, 500/*ms*/);
 	
        // Issue authorize call, and call the callback function upon success.
        IN.User.authorize(function() {
            clearInterval(id);
 			if (!called) {
                called = true;
                callback();
            }
        });
    };
    
    
    /*
     *
     * Data scraping (client only).
     *
     */
     
    /**
     * Fetch & scrape LinkedIn content. We get the following info:
     *
     *  - Name, headline title, summary, .
     *  - Number of connections.
     *  - Locations, positions (current and past)
     *  - Profile images.
     *
     *  @param callback     Function called with content info.
     */ 
    provider.fetch = function(callback) {
        authorize(function() {
            if (IN.User.isAuthorized()) {
                // Get user info & extract sentences.
                var fields = [
                    'id',
                    'public-profile-url',
                    'formatted-name',
                    'headline',
                    'num-connections',
                    'num-connections-capped',
                    'location',
                    'industry',
                    'summary',
                    'specialties',
                    'positions',
                    'picture-urls::(original)',
                ];
                IN.API.Raw("/people/~:(" + fields.join(',') + ")?format=json").result(function(response) {
                    var info = {};
                    info.success = true;
                    
                    // Main info.
                    info.id = response.id;
                    info.url = response.publicProfileUrl;
                    info.label = response.formattedName;
                    
                    // Sentences.
                    info.sentences = [];
                    
                    // - Title = name.
                    info.sentences.push(response.formattedName);
                    
                    // - Subtitle = headline.
                    info.sentences.push(response.headline||'');
                    
                    // - Price = number of connections.
                    info.sentences.push(response.numConnections + (response.numConnectionsCapped?'+':''));
                    
                    // - Location, industry, summary, specialties, positions.
                    if (response.location) info.sentences.push(response.location.name);
                    if (response.industry) info.sentences.push(response.industry);
                    if (response.summary) {
                        var sentences = splitSentences(response.summary);
                        for (var j = 0; j < sentences.length; j++) {
                            info.sentences.push(sentences[j]);
                        }
                    }
                    if (response.specialties) info.sentences.push(response.specialties);
                    if (response.positions) {
                        for (var i = 0; i < response.positions.values.length; i++) {
                            var position = response.positions.values[i];
                            if (position.title) info.sentences.push(position.title);
                            if (position.summary) {
                                var sentences = splitSentences(position.summary);
                                for (var j = 0; j < sentences.length; j++) {
                                    info.sentences.push(sentences[j]);
                                }
                            }
                            if (position.company) {
                                info.sentences.push(position.company.name);
                                info.sentences.push(position.company.industry);
                            }
                            if (position.location) info.sentences.push(position.location.name);
                        }
                    }
                    
                    // Profile images.
                    if (response.pictureUrls) {
                        info.images = response.pictureUrls.values;
                    }
                    
                    // Done!
                    callback(info);
                })
            } else {
                // Can't issue API calls.
                var info = {};
                info.success = false;
                info.error = "User not logged into application.";
                callback(info);
            }
        });
    };
    
})(providers);
