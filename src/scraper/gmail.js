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
    var provider = new Provider("Gmail", /*TODO remove*/ /^$/);
    providers[provider.name] = provider;
    
    if (typeof $ === 'undefined') {
        // Running on server, only metadata is needed.
        return;
    }
    
    
    /*
     *
     * Interface with the Gmail web API (client only).
     *
     * App URL: https://console.developers.google.com/apis/credentials?project=grocery-portraits
     *
     */
    
    // Gmail settings.
    var CLIENT_ID = "612453794408-nqvjmtgmsm0am8l9o2rahu36mlrg0qgd.apps.googleusercontent.com";
    var SCOPES = 'https://www.googleapis.com/auth/gmail.readonly';
    
    // Load the SDK asynchronously
    window.gmAsyncInit = function() {
        gapi.load('client:auth2', function() {
            //TODO batch load?
            gapi.client.load('plus', 'v1').then(
                function() {
                    gapi.client.load('gmail', 'v1').then(
                        function() {
                            console.debug("Gmail API loaded");
                            
                            // Initialize GoogleAuth object.
                            var auth2 = gapi.auth2.init({
                                'client_id': CLIENT_ID,
                                'scope': SCOPES,
                            });
                           
                            // Route GoogleAuth signin status events through our own interface.
                            auth2.isSignedIn.listen(function(status) {
                                if (status) {
                                    provider.dispatchEvent(new CustomEvent('auth', {detail: {message: "Signed in", authorized: true}}));
                                } else {
                                    provider.dispatchEvent(new CustomEvent('auth', {detail: {message: "Signed out", authorized: false}}));
                                }
                            });
                            
                            // Done! Send loaded event to all listeners.
                            provider.dispatchEvent(new CustomEvent('loaded', {detail: {message: "API loaded"}}));
                        },
                        console.error
                    );
                },
                console.error
            );
        });
    };
    (function(d, s, id) {
        var js, fjs = d.getElementsByTagName(s)[0];
        if (d.getElementById(id)) return;
        js = d.createElement(s); js.id = id;
        js.src = "//apis.google.com/js/api.js?onload=gmAsyncInit";
        fjs.parentNode.insertBefore(js, fjs);
    }(document, 'script', 'gmail-jssdk'));
    
    /**
     * Get string from base64url UTF-8 string.
     *
     *  @param data     Base64url string.
     *
     *  @return the decoded string.
     */
    var base64urlToString = function(data) {
        // Gmail API calls use the base64url encoding, so convert chars 62-63 from -_ to +/.
        var s = atob(data.replace(/-/g,'+').replace(/_/g,'/'));
        
        // Convert from UTF-8 to Unicode.
        return decodeURIComponent(escape(s));
    }

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
     * Ensure that the Gmail user is logged & the app is authenticated before issuing calls.
     *
     *  @param callback     Function called at the end of the process.
     */     
    var authorize = function(callback) {
        var auth2 = gapi.auth2.getAuthInstance();
        if (auth2.isSignedIn.get()) {
            // Already signed in, call the callback function directly.
            callback({});
            return;
        }
            
        // Google GoogleAuth.signin() doesn't call our callback when the user closes the popup, and there is no built-in way to detect
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
                        setTimeout(function(){ promise.cancel('closed'); }, 100);
                    }
                }, 100);
                return win;
            };
        })(window.open);

        // Issue call as usual.
        promise = auth2.signIn().then(
            callback, 
            function(reason) { callback({error: (reason && reason.message ? reason.message : 'denied')}); }
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
                        
                        // Batch for image attachments.
                        var hasImages = false;
                        var batchImages = gapi.client.newBatch();
                        var imageRequestInfos = []; // Holds the message object for the matching batchImage request ID.
                        
                        for (var id in response.result) {
                            var result = response.result[id].result;
                            if (result.error) {
                                // Ignore.
                            } else {
                                var message = {body: []};
                                
                                // Get subject.
                                var headers = result.payload.headers;
                                for (var i = 0; i < headers.length; i++) {
                                    var header = headers[i];
                                    if (header.name.toLowerCase() == 'subject') {
                                        message.subject = header.value;
                                        break;
                                    }
                                }
                                
                                // Get body.
                                var body = result.payload.body;
                                if (body.size && body.data) {
                                    message.body = message.body.concat(getMessageBody(base64urlToString(body.data)));
                                }
                                
                                
                                // Process parts.
                                var parts = result.payload.parts;
                                if (parts) {
                                    for (var i = 0; i < parts.length; i++) {
                                        var part = parts[i];
                                        switch (part.mimeType) {
                                            case 'text/plain':
                                                if (part.body.size && part.body.data) {
                                                    message.body = message.body.concat(getMessageBody(base64urlToString(part.body.data)));
                                                }
                                                break;
                                                
                                            case 'text/html':
                                                // Ignore, assume that such messages have a text/plain version along with the text/html for interoperability.
                                                break;
                                                
                                            default:
                                                if (part.mimeType.match(/^image\//)) {
                                                    // Attached image. Schedule request in batch.
                                                    hasImages = true;
                                                    var id = batchImages.add(gapi.client.gmail.users.messages.attachments.get({userId: 'me', messageId: message.id, id: part.body.attachmentId}));
                                                    imageRequestInfos[id] = {message: message, mimeType: part.mimeType};
                                                }
                                        }
                                    }
                                }
                                
                                info.messages.push(message);
                            }
                        }
                        
                        if (hasImages) {
                            batchImages.then(
                                function(response) {
                                    for (var id in response.result) {
                                        var result = response.result[id].result;
                                        if (result.error) {
                                            // Ignore.
                                        } else {
                                            // Build data URI from result.
                                            var requestInfo = imageRequestInfos[id];
                                            if (!requestInfo.message.images) requestInfo.message.images = [];
                                            requestInfo.message.images.push(getImageUri(result.data, requestInfo.mimeType));
                                        }
                                    }
                                    
                                    // Done!
                                    callback(info);
                                },
                                function(reason) {
                                    // Attachment request failed, ignore as we already have some data to work with (subject lines, bodies...).
                                    callback(info);
                                }
                            );
                        } else {
                             // Done!
                            callback(info);
                        }
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
     * Client interface.
     *
     */
     
    /**
     * Request authorization from Gmail.
     *
     *  @param callback     Function called with content info.
     */ 
    provider.authorize = function(callback) {
        var info = {};
        authorize(function(response) {
            if (response && !response.error) {
                info.success = true;
                info.message = "Authorization granted";
            } else {
                info.success = false;
                switch (response.error) {
                    case 'closed':
                    case 'denied':  info.message = "Authorization denied";  break;
                    default:        info.message = "Authorization error";   break;
                }
            }
            callback(info);
        });
    };
     
    /**
     * Fetch & scrape Gmail content. We get the following info:
     *
     *  - Subject line.
     *  - Textual body (not HTML).
     *  - Embedded images.
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
                                        for (var j = 0; j < message.body.length; j++) {
                                            var sentences = splitSentences(message.body[j]);
                                            for (var k = 0; k < sentences.length; k++) {
                                                info.sentences.push(sentences[k]);
                                            }
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
                    case 'closed':
                    case 'denied':  info.error = "Authorization denied";    break;
                    default:        info.error = "Authorization error";     break;
                }
                callback(info);
            }
        });
    };
    
})(providers);
