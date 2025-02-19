/** Default page format class (see grocery-signs.css) */
var pageFormatClass = "page-us";

/** Delay for scheduled refresh events. */
var refreshDelay = 500; /*ms*/

/** Last scheduled refresh event. */
var refreshEvent = null;


/**
 * Add random pages. Triggered by the infinite scroll mechanism (spinning icon).
 * Each page element fetches /random.svg, which selects a random scrape permutation.
 */
function appendPages(nb) {
    var $pages = $("#pages");
    var nbPages = $("#pages .page").length;
    if (nbPages == 0) {
        // Add spinning icon; triggers appendPages() when visible.
        var end = $("<div id='pages-end' class='col-xs-12'><span class='icon icon-generate rotate-ccw'></span><span class='sr-only'>Loading...</span></div>");
        $pages.append(end);
        $(window).on('resize scroll', function() {
            var rect = end[0].getBoundingClientRect();
            if (rect.top < $(window).height()) {
                // Spinning icon is visible, append next page.
                appendPages(2);
            }
        });
    }
    
    // Add nb pages and render a random SVG within.
    for (var i = 0; i < nb; i++) {
        // Create page container.
        var page = $("<div class='page'></div>").addClass(pageFormatClass);
        $pages.append($("<div class='page-container col-xs-12 col-sm-6'></div>")
                .append($("<div class='thumbnail'></div>").append(page))
        );
                
        // Load a random page in the container.
        loadPage('random.svg?_='+Math.random(), page);
    }
    
    // Move spinning icon to end of viewport.
    $("#pages-end").appendTo($pages);
}

function loadPage(url, container, options) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.onload = function(e) {
        if (this.status == 200) {
            // Remember raw SVG data.
            $(container).data('svg', this.response)

            refreshFrame(container);
        }
    };
    xhr.send();
}

/**
 *  Schedule a refresh event.
 */
function scheduleRefresh() {
    if (refreshEvent) {
        clearTimeout(refreshEvent);
    }
    refreshEvent = setTimeout(function() {refresh(); refreshEvent = null;}, refreshDelay);
}

/**
 *  Refresh all active pages.
 */
function refresh() {
    // Call refreshFrame on each active page.
    $(".page").each(function(index, container) {
        refreshFrame(container);
    });
}

/**
 *  Refresh the SVG output frame.
 */
function refreshFrame(container) {
    var svg = $(container).data('svg');
    $(container)
        .empty()
        .append(svg);
}
