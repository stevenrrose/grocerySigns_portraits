/*
 *
 * Scraping.
 *
 */
 
/** Image fetch URL. */
var fetchImage = "scraper/fetchImage";


/*
 *
 * Algorithms and functions.
 *
 */

/**
 * Generate a random string.
 *
 *  @param size     Size of string to generate. Negative for alpha only.
 */
function randomStr(size) {
    var chars;
    if (size < 0) {
        // Alpha only.
        size = -size;
        chars = "abcdefghijklmnopqrstuvwxyz";
    } else {
        chars = "0123456789abcdefghijklmnopqrstuvwxyz";
    }
    var str = "";
    for (var i=0; i < size; i++) {
        str += chars[Math.floor(Math.random()*chars.length)];
    }
    return str;
}

/**
 *  Split string into sentences.
 *  
 *  @param text     String to split.
 */
function splitSentences(text) {
    return text.replace(/([!?]|\.\.\.)\s+/g, "$1. ").split(/[.;]\s/);
}


/*
 *
 * PDF Generation.
 *
 */

// PDF.js doesn't like concurrent workers so disable them. This will 
// generate 'Warning: Setting up fake worker.' on the console.
PDFJS.disableWorker = true;

/**
 *  Render PDF in a canvas using PDF.js.
 *  
 *  @param url          URL of PDF to render (supports blob and data URIs).
 *  @param container    Canvas container.
 *  @param options      Option object:
 *                      - scale: scale factor (default 2)
 *                      - url: if defined, wrap img tag into link with given href
 */
function renderPDF(url, container, options) {
    var options = options||{};
    
    PDFJS.getDocument(url).then(function(pdfDoc) {
        /* Only render the first page. */
        pdfDoc.getPage(1).then(function(page) {
            /* Compute ideal scaling factor: twice the page width for optimal subsampling. */
            var pageWidth = page.getViewport(1).width;
            var scale = options.scale || 2;
            scale *= $(container).width()/pageWidth;
            
            /* Create viewport and canvas. */
            var viewport = page.getViewport(scale);
            var canvas = document.createElement('canvas');
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            //$(container).empty().append(canvas);

            /* Render page. */
            page.render({
                intent: print,
                canvasContext: canvas.getContext('2d'),
                viewport: viewport
            }).then(function() {
//              $(container).empty().append(canvas);
                var image = $("<img></img>").attr("src", canvas.toDataURL("image/png"));
                $(container).empty().append(image);
                if (options.url) {
                    image.wrap($("<a target='_blank'></a>").attr('href', options.url));
                }
            });
        });
    });
}

/**
 * Load & render a PDF in a canvas.
 * 
 *  @param url          URL of PDF to render (supports blob and data URIs).
 *  @param container    Canvas container.
 *  @param options      Option object:
 *                      - scale: scale factor (default 2)
 *                      
 *  @see renderPDF
 */
function loadPDF(url, container, options) {
    var options = options||{};
    
    // Don't render the remote URL directly, as we need access to the X-Scrape-URL response header,
    // used to link the rendered pages to the main app's matching scrape page. We also need the data
    // as a blob and not as a plain string for better performance, and since jQuery doesn't support 
    // that, then use plain XHR instead of $.ajax().
    // renderPDF("random.pdf", page, 1);
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'blob';
    xhr.onload = function(e) {
        if (this.status == 200) {
            // The scrape page is passed by the server as the X-Scrape-URL response header.
            options.url = this.getResponseHeader('X-Scrape-URL');

            // Pass the blob URL to PDF.js.
            var blob = this.response;
            var url = window.URL.createObjectURL(blob);

            renderPDF(url, container, options);
        }
    };
    xhr.send();
}


/*
 *
 * SVG Generation.
 *
 */

/**
 *  Render SVG in a container.
 *  
 *  @param svg          SVG content render.
 *  @param container    Container.
 */
function renderSVG(svg, container, options) {
    /* Insert SVG object. */
    $(container).empty().append(svg);
}

/*
 *
 * Interface functions.
 *
 */
 
/** Default page format class (see grocery-portraits.css) */
var pageFormatClass = "page-us";

/** Delay for scheduled refresh events. */
var refreshDelay = 500; /*ms*/

/** Last scheduled refresh event. */
var refreshEvent = null;

/** Last scraped texts. */
var scrapedTexts = {};

/** Last loaded images. */
var loadedImages = [];

/** Last scraped images. */
var scrapedImages = [];

/**
 * Deferred loading of images.
 * 
 * @param {Object} state    State object with provider/id/images fields.
 * 
 * @see ImageFile
 */
function loadImages(state) {
    loadedImages = [];
    $.each(state.images||[], function(i, url) {
        if (url.match(/^data:/)) {
            // Don't load data URIs through the fetchImage proxy since we already have the data as base64.
            loadedImages[i] = new ImageFile(url, imageLoaded);
        } else {
            loadedImages[i] = new ImageFile(
                    fetchImage 
                    + "?url=" + encodeURIComponent(url) 
                    + "&provider=" + encodeURIComponent(state.provider)
                    + "&id=" + encodeURIComponent(state.id), 
                    imageLoaded);
        }
    });
}

/**
 *  Get file name for the given page (without extension).
 *  
 *  @param index    Page index.
 *  
 *  @see generatePDF()
 *  @see refreshFrame()
 */
function getFileName(index) {
    var templateName = $("#page-template-" + index).val();
    var color = $("input[name='page-color-" + index + "']:checked").val();
    if (color != "") {
        templateName += "-" + color;
    }
    
    if (!currentState || !currentState.id) {
        // Manual input.
        return templateName;
    }
    
    var components = [];
    components.push(currentState.provider);
    components.push(currentState.id);
    if (currentState.since || currentState.until) {
        components.push(currentState.since||'');
        components.push(currentState.until||'');
    }
    components.push(templateName);
    if (currentState.randomize) {
        components.push(currentState.seed);
    }
    return components.join('-');
}

/**
 *  Download the PDF for the given page.
 *  
 *  @param index    Page index.
 *  
 *  @see generatePDF()
 *  @see getFileName()
 */
function downloadPDF(index) {
    var templateName = $("#page-template-" + index).val();
    var color = $("input[name='page-color-" + index + "']:checked").val();
    var fileName = getFileName(index);
    
    // Output to blob.
    var stream = blobStream();
    
    // Eventually download the blob as PDF.
    stream.on('finish', function() {
        saveAs(stream.toBlob('application/pdf'), fileName + '.pdf');
    });

    // Generate the PDF.
    generatePDF(stream, templates[templateName], scrapedTexts, scrapedImages, {color: color});
}

/**
 *  Download the SVG for the given page.
 *  
 *  @param index    Page index.
 *  
 *  @see generateSVG()
 *  @see getFileName()
 */
function downloadSVG(index) {
    var templateName = $("#page-template-" + index).val();
    var color = $("input[name='page-color-" + index + "']:checked").val();
    var fileName = getFileName(index);
    
    // Output to blob.
    var stream = blobStream();
    
    // Eventually download the blob as PDF.
    stream.on('finish', function() {
        saveAs(stream.toBlob('image/svg+xml'), fileName + '.svg');
    });

    // Generate the PDF.
    generateSVG(stream, templates[templateName], scrapedTexts, scrapedImages, {color: color});
}

/**
 *  Refresh the PDF output frame.
 *  
 *  Typically called from input change event handlers.
 *  
 *  @param index    Page index.
 *  
 *  @see generatePDF()
 *  @see getFileName()
 */
function refreshFrame(index) {
    var container = $("#page-" + index);
    var templateName = $("#page-template-" + index).val();
    var color = $("input[name='page-color-" + index + "']:checked").val();
    var seed = $("#seed").val();
    var fileName = getFileName(index);

    if (pdfMode) {    
        // Output to blob.
        var stream = blobStream();
        
        // Eventually output the blob into given container.
        stream.on('finish', function() {
            // Get & remember blob object.
            var blob = stream.toBlob('application/pdf');
            $(container).data("blob", blob);
            
            // Clear previous blob URL and remember new one.
            var url = $(container).data("blobUrl");
            if (url) {
                window.URL.revokeObjectURL(url);
            }
            url = window.URL.createObjectURL(blob);
            $(container).data("blobUrl", url);

            // Render blob URL into container.
            renderPDF(url, container);
            
            // Set link attributes.
            var index = $(container).data("index");
            $("#page-download-" + index)
                .attr('href', url)
                .attr('target', '_blank')
                .attr('download', fileName + '.pdf');
        });

        // Generate the PDF.
        generatePDF(stream, templates[templateName], scrapedTexts, scrapedImages, {color: color});
        
    } else {

        // Generate SVG download link URL.
        var images = [];
        for (var i in scrapedImages) {
            images.push(scrapedImages[i].url);
        }
        var parameters = {
            seed: seed,
            fields: scrapedTexts,
            images: images,
            options: {color: color}
        };
        var url = 'templates/' + templateName + '.pdf'
            + "?parameters=" + encodeURIComponent(JSON.stringify(parameters));

        // Generate the SVG.
        var svg = generateSVG(templates[templateName], scrapedTexts, scrapedImages, {color: color});

        // Save SVG data.
        var blob = new Blob([svg], {type: 'image/svg+xml'});
        $(container).data("blob", blob);

        // Render SVG into container.
        renderSVG(svg, container);
            
        // Set link attributes.
        var index = $(container).data("index");
        $("#page-download-" + index)
            .attr('href', url)
            .attr('target', '_blank')
            .attr('download', fileName + '.pdf');
    }

}

/**
 *  Refresh all active pages.
 */
function refresh() {
    // Refresh scraped text array.
    $(".FIELD").each(function(i, e) {
        scrapedTexts[$(e).attr("id")] = $(e).val();
    });
    
    // Call refreshFrame on each active page.
    $(".page").each(function(index) {
        refreshFrame(index);
    });
}

/**
 *  Schedule a refresh event.
 *  
 *  This allows for interactive usage without having to recompute the whole UI at 
 *  each keypress.
 */
function scheduleRefresh() {
    if (refreshEvent) {
        clearTimeout(refreshEvent);
    }
    refreshEvent = setTimeout(function() {refresh(); refreshEvent = null;}, refreshDelay);
}

/**
 *  Update progress information during scraping.
 *
 *  @param step         Step (starts at 1).
 *  @param nbSteps      Total number of steps.
 *  @param stepLabel    Human-readable step label to display.
 */
function progress(step, nbSteps, stepLabel) {
    var percent = (step/(nbSteps+1))*100;
    $("#progress .progress-bar").attr('aria-valuenow', step).attr('aria-valuemax', nbSteps+1).attr('style','width:'+percent.toFixed(2)+'%').find("span").html(step + "/" + nbSteps);
    $("#progressStep").html(stepLabel);
}

/**
 *  Enable/disable interface.
 *
 *  @param enabled  Whether to enable or disable interface.
 *  @param modal    Modal dialog selector (defaults to '#progressDialog')
 */
function enableInterface(enabled, modal) {
    $(modal||"#progressDialog").modal(enabled?'hide':'show');
}

/**
 *  Display scraping result message.
 *  
 *  @param success  Whether the operation was successful.
 *  @param title    Message title.
 *  @param message  Message body.
 */
function displayMessage(success, title, message) {
    $("#parameters .alert").appendTo("#fields");
    $("#parameters").append(
          "<div class='alert small alert-dismissible alert-" + (success ? "success" : "danger") + " fade in' role='alert'>"
        + "<button type='button' class='close' data-dismiss='alert' aria-label='Close'><span aria-hidden='true'>&times;</span></button>"
        + "<span class='glyphicon glyphicon-" + (success ? "ok" : "exclamation") + "-sign'></span> "
        + "<strong class='sr-only'>" + title + "</strong> "
        + message
        + "</div>"
    );
}

/**
 *  Populate fields 
 */
function populateFields() {
    var sentences;
    if (currentState.randomize) {
        // Shuffle sentences & images.
        sentences = shuffleSentences(currentState.sentences, currentState.seed);
        scrapedImages = shuffleImages(loadedImages, currentState.seed);
    } else {
        // Use sentences & images in order.
        sentences = currentState.sentences;
        scrapedImages = loadedImages;
    }

    // Populate fields with resulting values.
    $(".FIELD").each(function(i, e) {
        $(e).val(sentences[i]);
    });
}

/**
 *  Fetch item callback: display result in fields.
 *
 *  @param provider     Item provider descriptor.
 *  @param info         Item info.
 *  @param options      Options object passed to provider.fetch().
 */
function fetchCallback(provider, info, options) {
    if (info.success) {
        // GA: successful scrape.
        ga('send', 'event', {
            eventCategory: 'Scraper',
            eventAction: 'success',
            eventLabel: provider.name,
            'dimension1': provider.name,
            'metric2': 1
        });
        
        // Success, gather & display item data.
        console.log("fetchCallback", info);
        displayMessage(true, "Success!", provider.name + " <a class='alert-link' target='_blank' href=\'" + info.url + "\'>" + info.id + " / " + info.label + "</a>");
        
        var sentences = processSentences(info);
        var images = processImages(info);
        var seed = generateRandomSeed();
        
        // Update app state with new info.
        updateState({
            provider: provider.name,
            id: info.id,
            since: (options.since ? getTimestampFromDate(options.since) : undefined),
            until: (options.until ? getTimestampFromDate(options.until) : undefined),
            randomize: $("#randomize").prop('checked'),
            seed: seed,
            sentences: sentences,
            images: images
        });
    } else {
        // Failure.
        console.error("fetchCallback", info);      
        displayMessage(false, "Scraping failed!", provider.name + " error: " + info.error);
    }

    // Done!
    enableInterface(true);
}

/**
 * Build sentences to populate fields with.
 * 
 * @param {Object} info scrape result
 * 
 * @returns {Array} array of normalized sentences
 */
function processSentences(info) {
    // Build sentences to populate fields with.
    // - title, vendor and price (even empty to ensure predictable order).
    var sentences = [
        normalizeString(info.title), 
        normalizeString(info.vendor), 
        normalizeString(info.price),
    ];
    // - nonempty sentences.
    $.each(info.sentences||[], function(i, v) {
        v = normalizeString(v);
        if (v != "") sentences.push(v);
    });
    
    return sentences;
}

/**
 * Build list of images.
 * 
 * @param {Object} info scrape result
 * 
 * @returns {Array} array of normalized images
 */
function processImages(info) {
    var images = [];
    $.each(info.images||[], function(i, v) {
        if (v) images.push(v);
    });
    
    return images;
}

/**
 *  Scrape random content and call fetchCallback() upon result.
 *  
 *  @param provider     Provider to scrape.
 *  @param dateRange    Date range for messages, takes any of the following values:
 *                          - undefined or empty: no range
 *                          - 1d: past day
 *                          - 1w: past week
 *                          - 1m: past month
 *                          - 1y: past year
 *  @param dateSpan     Date window span.
 */
function scrapeRandom(provider, dateRange, dateSpan) {
    // Disable interface elements.
    enableInterface(false);
    
    // Main step.
    var main = function(step, nbSteps) {
        var options = {};
        
        if (provider.hasDate) {
            // Compute date bounds.
            var now = new Date();
            var minDate = new Date(now);
            switch (dateRange) {
                case '1d':  minDate.setDate(now.getDate()-1);           break;
                case '1w':  minDate.setDate(now.getDate()-7);           break;
                case '1m':  minDate.setMonth(now.getMonth()-1);         break;
                case '1y':  minDate.setFullYear(now.getFullYear()-1);   break;
                default:    minDate.setTime(0);
            }
            if (provider.minDate && provider.minDate > minDate) {
                minDate = new Date(provider.minDate);
            }
            
            // Select random timestamp range.
            var min = minDate.getTime(), max = now.getTime();
            
            // - Beginning of date range.
            var since = new Date(min + Math.floor(Math.random()*(max-min)));
            
            // - End of date range.
            var until = new Date(since);
            until.setDate(until.getDate() + dateSpan);
            if (until.getTime() > max) {
                // Date is in the future, adjust range.
                until.setTime(max);
                since.setTime(until); since.setDate(since.getDate() - dateSpan);
                if (since.getTime() < min) {
                    // Shorten range.
                    since.setTime(min);
                }
            }
            
            options.since = since;
            options.until = until;
        }
        
        // Fetch content from provider.
        var label = "Fetching " + provider.name + " content";
        progress(step, nbSteps, label + "...");

        // GA: scrape request.
        ga('send', 'event', {
            eventCategory: 'Scraper',
            eventAction: 'request',
            eventLabel: label,
            'dimension1': provider.name,
            'metric1': 1
        });

        try {
            provider.fetch(options, function(info) {fetchCallback(provider, info, options);});
        } catch (e) {
            console.log("exception", e);
            displayMessage(false, "Exception!", "Exception: " + e);
            enableInterface(true);
        }
    };
    
    if (provider.hasDate && !provider.minDate) {
        // We need min date first.
        var label = "Getting minimum date from " + provider.name;
        progress(1, 2, label + "...");

        provider.getMinDate(function(minDate) {
            provider.minDate = minDate;
            
            // Call main step in any case.
            main(2, 2);
        });
    } else {
        // Call main step directly.
        main(1,1);
    }
}

/**
 *  Request authorization from the currently selected provider.
 */
function authorize() {
    try {
        var provider = providers[$("#source").val()];
        provider.authorize(function(info) {
            if (info.success) {
                console.log(provider.name, info.message);
            } else {
                console.error(provider.name, info.message);
            }
            displayMessage(info.success, "Authorization", provider.name + " " + info.message);
        });
    } catch (e) {
        console.error("exception", e);
        displayMessage(false, "Exception!", "Exception: " + e);
    }
}

/**
 *  Disconnect the currently selected provider.
 */
function disconnect() {
    try {
        var provider = providers[$("#source").val()];
        provider.disconnect(function(info) {
            if (info.success) {
                console.log(provider.name, info.message);
            } else {
                console.error(provider.name, info.message);
            }
            displayMessage(info.success, "Disconnection", provider.name + " " + info.message);
        });
    } catch (e) {
        console.error("exception", e);
        displayMessage(false, "Exception!", "Exception: " + e);
    }
}

/**
 *  Scrape random data from the currently selected provider.
 */
function scrapeFields() {
    var provider = providers[$("#source").val()];
    var dateRange = $("#date").val();
    var dateSpan = Number.parseInt($("#dateSpan").val());
    scrapeRandom(provider, dateRange, dateSpan);
}

/**
 *  Called when random seed is changed by any means. Reshuffles fields & refresh pages.
 */
function seedChanged() {
    updateState($.extend({}, currentState, {randomize: $("#randomize").prop('checked'), seed: $("#seed").val()}));
}

/**
 * Update interface when provider changes: authorize/generate, date range etc.
 */
function providerChanged() {
    var provider = providers[$("#source").val()];
    if (provider && provider.loaded) {
        if (provider.authorized) {
            $("#authorize").hide().prop('disabled', true);
            $("#disconnect").show().prop('disabled', !provider.disconnect);
            $("#generate").prop('disabled', false);
        } else {
            $("#authorize").show().prop('disabled', false);
            $("#disconnect").hide().prop('disabled', true);
            $("#generate").prop('disabled', true);
        }
        $("#date, #dateSpan").prop('disabled', !provider.hasDate);
    } else {
        $("#generate, #authorize, #disconnect").prop('disabled', true);
        $("#authorize").show();
        $("#disconnect").hide();
        $("#date").prop('disabled', true);
    }
}

/**
 * Update interface depending on the providers' API load state.
 */
$(function() {
    $("#source").change(providerChanged);
    providerChanged();
    $.each(providers, function(i, provider) {
        // Init flags.
        provider.loaded = false;
        provider.authorized = false;
        
        // Disable option in drop-down.
        var $option = $("#source option[value='"+provider.name+"']");
        $option.prop('disabled', true);
        // Update interface on 'loaded' event.
        provider.addEventListener('loaded', function(e) {
            console.log(provider.name, e.detail.message);
            provider.loaded = true;
            
            // Enable option in drop-down.
            $option.prop('disabled', false);
            
            providerChanged();
        });
        
        // Listener for authorization event.
        provider.addEventListener('auth', function(e) {
            console.log(provider.name, e.detail.message);
            provider.authorized = e.detail.authorized;
            
            providerChanged();
        });
     });
});


/*
 * 
 * Saving.
 * 
 */

/**
 * Save all current pages at once.
 *
 *  @see savePage()
 */
function saveAll() {
   // Call savePage on each active page.
    $(".page").each(function(index) {
        savePage(index);
    });
}

/**
 * Save the page.
 *  
 *  @param index    Page index.
 *  
 *  @see saveAll()
 */
function savePage(index) {
    var container = $("#page-" + index);
    var blob = $(container).data("blob");
    var params = [];
    var fileName = getFileName(index);
    if (fileName) {
        // Encode filename with MD5 for better privacy.
        params.push("filename=" + encodeURIComponent(md5(fileName)));
    }
    if (currentState) {
        params.push("provider=" + encodeURIComponent(currentState.provider));
        params.push("userId=" + encodeURIComponent(currentState.id));
    }

    console.log("Saving "+ fileName);

    $.ajax({
        method: "POST",
        headers: {"X-Scrape-App": "Web"},
        url: 'savePage?' + params.join("&"),
        processData: false,
        data: blob,
        contentType: blob.type,
        success: function(data, textStatus, jqXHR) {
            // GA: saved page.
            ga('send', 'event', {
                eventCategory: 'Page',
                eventAction: 'saved',
                eventLabel: fileName,
                'dimension1': currentState.name,
                'metric3': 1
            });
        },
        error: function(jqXHR, textStatus, errorThrown) {
            console.log("ajaxError", textStatus, errorThrown);
            displayMessage(false, "Ajax error!", "Ajax error: " + errorThrown);
        }
    });
}


/*
 *
 * State handling. 
 *
 */
 
/** Current hash, used for quick change detection. */
var currentHash = undefined;

/** Current state object. */
var currentState = undefined;

/**
 *  Update app state with given data.
 *  
 *  @param {object} state   State object.
 */
function updateState(state, replace) {
    // Compute hash from info.
    var hash = JSON.stringify(state);
    
    // No need to update everything if hash didn't change.
    if (currentHash == hash) return;
    
    $("#source option[value='" + state.provider + "']").prop('selected', true);
    $("#randomize").prop('disabled', false).prop('checked', state.randomize).closest('label').removeClass('disabled');
    $("#save, .page-save").prop('disabled', false).removeClass('disabled');
    $("#seed, #genSeed").prop('disabled', !state.randomize);
    $("#seed").val(state.seed);
    if (typeof(currentState) === 'undefined' || JSON.stringify(state.images) !== JSON.stringify(currentState.images) /* FIXME: ugly but straightforward */) {
        loadImages(state);
    }
    $(".FIELD").prop('readonly', true);
    
    currentHash = hash;
    currentState = state;
    
    if (replace) {
        history.replaceState(state, null);
    } else {
        var components = [];
        components.push(state.provider);
        components.push(state.id);
        if (state.since || state.until) {
            components.push(state.since||'');
            components.push(state.until||'');
        }
        var url = '#' + components.join('-');
        if (state.randomize) {
            url += '?randomize=' + state.seed;
        }
        history.pushState(state, null/*, url*/);
    }
    
    computeActualMaxFieldLengths(state.seed);
    populateFields();
    refresh();
}

/** History state listener. */ 
window.onpopstate = function() {
    updateState(history.state, true);
};


$(document).ajaxError(function(event, jqXHR, ajaxSetting, thrownError) {
    console.log("ajaxError", thrownError);
    displayMessage(false, "Ajax error!", "Ajax error: " + thrownError);
    enableInterface(true);
});