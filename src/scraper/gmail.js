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
    var SCOPES = 'profile,https://www.googleapis.com/auth/userinfo.profile,https://www.googleapis.com/auth/gmail.readonly'.split(',');
    
    // Load the SDK asynchronously
    window.gmAsyncInit = function() {
        gapi.client.load('plus', 'v1').then(
            function() {
                gapi.client.load('gmail', 'v1').then(function() {
                        console.log("Gmail API loaded");
                    },
                    console.error
                );
            },
            console.error
        )
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
    
    /**
     * Get messages from Gmail.
     *
     *  @param callback     Function called with results.
     */
    var getMessages = function(callback) {
        gapi.client.gmail.users.messages.list({userId: 'me'}).then(
            function(response) {
                // Get all messages in batch.
                var messages = response.result.messages;
                var batch = gapi.client.newBatch();
                for (var i = 0; i < messages.length; i++) {
                    var message = messages[i];
                    batch.add(gapi.client.gmail.users.messages.get({userId: 'me', id: message.id}));
                }
                batch.then(
                    function(response) {
                        var info = {messages: []};
                        for (var id in response.result) {
                            var result = response.result[id].result;
                            if (result.error) {
                                // Ignore.
                            } else {
                                var message = {};
                                
                                // Get subject.
                                var headers = result.payload.headers;
                                for (var i = 0; i < headers.length; i++) {
                                    var header = headers[i];
                                    if (header.name.toLowerCase() == 'subject') {
                                        message.subject = header.value;
                                    }
                                }
                                
                                // Get body TODO
                                
                                // Get images TODO
                                
                                info.messages.push(message);
                            }
                        }
                        
                        // Done!
                        callback(info);
                    },
                    function(reason) {
                        // Pass to callback.
                        callback({error: reason});
                    }
                );                
            },
            function(reason) {
                // Pass to callback.
                callback({error: reason});
            }
        );
    }
    
    
    /*
     *
     * Data scraping (client only).
     *
     */
     
    /**
     * Fetch & scrape Gmail content. We get the following info:
     *
     *  - Subject line.
     *  - Textual body TODO
     *  - Embedded images TODO
     *
     *  @param callback     Function called with content info.
     */ 
    provider.fetch = function(callback) {
        var info = {success: false};
        authorize(function(response) {
            if (response && !response.error) {
                // Get profile info and message list.
                var batch = gapi.client.newBatch();
                var peopleId = batch.add(gapi.client.plus.people.get({userId: 'me'}));
                var getProfileId = batch.add(gapi.client.gmail.users.getProfile({userId: 'me'}));
                batch.then(
                    function(response) {
                        var people = response.result[peopleId].result;
                        var profile = response.result[getProfileId].result;
                        
                        // Main info.
                        info.id = profile.emailAddress||'';
                        info.url = 'mailto:'+profile.emailAddress;
                        info.label = people.displayName||'';
                        
                        // Profile image.
                        info.images = [];
                        if (people.image) {
                            info.images.push(people.image.url);
                        }
                    
                        // Sentences.
                        info.sentences = [];
                        
                        // - Title = name.
                        info.sentences.push(people.displayName||'');
                        
                        // - Subtitle = email address.
                        info.sentences.push(profile.emailAddress||'');
                        
                        // - Price = number of messages.
                        info.sentences.push(profile.messagesTotal.toString());
                        
                        // Message subjects/body/images.
                        getMessages(function(infoMessages) {
                            if (infoMessages.messages) {
                                for (var i = 0; i < infoMessages.messages.length; i++) {
                                    var message = infoMessages.messages[i];
                                    if (message.subject) {
                                        info.sentences.push(message.subject);
                                    }
                                    if (message.body) {
                                        var sentences = splitSentences(message.body);
                                        for (var j = 0; j < sentences.length; j++) {
                                            info.sentences.push(sentences[j]);
                                        }
                                    }
                                    if (message.images) {
                                        for (var j = 0; j < message.images.length; j++) {
                                            info.images.push(message.images[j]);
                                        }
                                    }
                                }
                        
                                // Done!
                                info.success = true;
                                callback(info);
                            } else {
                                info.error = "Can't get messages";
                                callback(info);
                            }
                        });
                    },
                    function(reason) {
                        // Batch failed, can't do much about that.
                        info.error = "API call failed";
                        callback(info);
                    }
                );
            } else {
                // Can't issue API calls.
                console.error(response);
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
