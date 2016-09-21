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
    provider.hasDate = true;
    providers[provider.name] = provider;
    
    if (typeof(exports) !== 'undefined') {
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
    
    // Load the SDK asynchronously.
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
     * Get Unix timestamp from Javascript date.
     *
     *  @param date     Javascript date.
     *
     *  @return Unix timestamp = date.getTime() / 1000
     */
    var getTimestamp = function(date) {
        return Math.floor(date.getTime()/*ms*/ / 1000);
    };
    
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
    
    /** Maximum number of messages to fetch. */
    var maxMessages = 100;
    
    /**
     * Get messages from Gmail.
     *
     *  @param options      Options:
     *                      - dateRange: Date range for messages, takes any of the following values:
     *                          * undefined or empty: no range
     *                          * 1d: past day
     *                          * 1w: past week
     *                          * 1m: past month
     *                          * 1y: past year
     *  @param callback     Function called with results.
     *
     *  @see provider.fetch()
     */
    var getMessages = function(options, callback) {
        // Parameters passed to messages.list.
        var params = {userId: 'me', maxResults: maxMessages};
        
        // TODO select random window in date range
        // We can use "newer:" and "older:" params
        // For "all time" we have to find the oldest one iteratively
        
        
        // For date range we use the search feature:
        //  https://developers.google.com/gmail/api/guides/filtering
        //  https://support.google.com/mail/answer/7190?hl=en
        switch (options.dateRange) {
            case '1d':    params.q = 'newer_than:1d'; break;
            case '1w':    params.q = 'newer_than:7d'; break;
            case '1m':    params.q = 'newer_than:1m'; break;
            case '1y':    params.q = 'newer_than:1y'; break;
        }

        // Returned results.
        var info = {messages: []};
        
        // Get message IDs.
        gapi.client.gmail.users.messages.list(params).then(
            function(response) {
                if (!response.result.messages) {
                    // No message, stop there.
                    callback(info);
                }
                
                // Get all message infos in batch.
                var messages = response.result.messages;
                var batch = gapi.client.newBatch();
                for (var i = 0; i < messages.length; i++) {
                    var message = messages[i];
                    // TODO add fields to limit message size
                    batch.add(gapi.client.gmail.users.messages.get({userId: 'me', id: message.id}));
                }
                batch.then(
                    function(response) {
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
                                if (result.payload.mimeType == 'text/plain' && body.size && body.data) {
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
                            // Execute batch first.
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
     * Get the lower bound for date ranges. 
     * Useful when selecting a random window in a potentially large range (e.g. "All time").
     *
     * There is no direct way to get the oldest message in a Gmail account so we use the
     * search feature with date ranges:
     *
     *      https://developers.google.com/gmail/api/guides/filtering
     *      https://support.google.com/mail/answer/7190?hl=en
     *
     *  @param callback     Called with either date upon success or a falsy value upon failure.
     */
    provider.getMinDate = function(callback) {
        // General failure handler.
        var failure = function() {
            callback();
        };
        
        // Find first year with at least one message: build batch with all year ranges in parallel.
        var minYear = 2000; // Arbitrary.
        var now = new Date();
        var batch = gapi.client.newBatch();
        var years = []; // Maps request ID to year.
        for (var y = minYear; y <= now.getFullYear(); y++) {
            // Date range for given year.
            var after = new Date(y, 0, 1);
            var before = new Date(y+1, 0, 1);
            
            // Enqueue request in batch.
            var requestId = batch.add(gapi.client.gmail.users.messages.list({
                userId: 'me', 
                maxResults: 1, // Need only one.
                q: 'before:' + getTimestamp(before) + ' after:' + getTimestamp(after)
            }));
            years[requestId] = y;
        }
        batch.then(
            function(response) {
                // Find successful batch response with lowest year.
                var minYear = Number.MAX_VALUE;
                for (var requestId in response.result) {
                    try {
                        var messages = response.result[requestId].result.messages;
                        if (messages && messages.length) {
                            minYear = Math.min(minYear, years[requestId]);
                        };
                    } catch (e) {console.error(e);}
                }
                if (minYear == Number.MAX_VALUE) failure();
                        
                // Now find first month in year. Use the same technique here.
                var batch = gapi.client.newBatch();
                var months = []; // Maps request ID to month.
                for (var m = 0; m < 12; m++) {
                    // Date range for given month in year.
                    var after = new Date(minYear, m, 1);
                    var before = new Date(minYear, m+1, 1);
                    
                    // Enqueue request in batch.
                    var requestId = batch.add(gapi.client.gmail.users.messages.list({userId: 'me', maxResults: 1, q: 'before:' + getTimestamp(before) + ' after:' + getTimestamp(after)}));
                    months[requestId] = m;
                }
                batch.then(
                    function(response) {
                        // Find successful batch response with lowest month.
                        var minMonth = Number.MAX_VALUE;
                        for (var requestId in response.result) {
                            try {
                                var messages = response.result[requestId].result.messages;
                                if (messages && messages.length) {
                                    minMonth = Math.min(minMonth, months[requestId]);
                                };
                            } catch (e) {console.error(e);}
                        }
                        if (minMonth == Number.MAX_VALUE) failure();
                        
                        // Found!
                        
                        // Year+month is good enough so stop there.
                        callback(new Date(minYear, minMonth, 1));
                    },
                    failure
                );
            },
            failure
        );
    };
         
    /**
     * Fetch & scrape Gmail content. We get the following info:
     *
     *  - Subject line.
     *  - Textual body (not HTML).
     *  - Embedded images.
     *
     *  @param options      Options:
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
                        
                        // Meta info.
                        info.id = profile.emailAddress||'';
                        info.url = 'mailto:'+profile.emailAddress;
                        info.label = people.displayName||'';
                        
                        // Fixed fields.

                        // - Title = name.
                        info.title = people.displayName||'';
                        
                        // - Vendor = email address.
                        info.vendor = profile.emailAddress||'';
                        
                        // - Price = number of messages.
                        info.price = profile.messagesTotal.toString();
                    
                        // Sentences.
                        info.sentences = [];
                        
                        // Images.
                        
                        // - Profile image.
                        info.images = [];
                        if (people.image) {
                            info.images.push(people.image.url);
                        }
                        
                        // Message subjects/body/images.
                        getMessages(options, function(infoMessages) {
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
