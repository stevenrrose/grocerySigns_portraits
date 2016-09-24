process.chdir(__dirname);

var request = require('request');
var express = require('express');
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var swig = require('swig');

var scraper = require('./scraper.js');
var templates = require('./templates.js');

/** Max saved filename length. */
var maxFilenameLength = 100;

/** Max saved file size. */
var maxFileSize = 80000;

/**
 * 
 * DB stuff.
 * 
 */
var db = require('./db.js');
var Image = db.Image;
var SavedPage = db.SavedPage;

/**
 * providers
 * 
 * Provider list.
 */
var providers = Object.keys(scraper.providers);

/**
 * app
 * 
 * Main Express router instance. 
 */
var app = express();
app.use(bodyParser.json());
var cookiesOptions = require('../config/cookies.json');
app.use(cookieParser(cookiesOptions.secret));

// Initialize provider-specific routes.
for (var id in scraper.providers) {
    var provider = scraper.providers[id];
    if (provider.initRoutes) {
        provider.initRoutes(app);
    }
}

/*
 * Static routes.
 */
app.use(express.static(__dirname + '/../client'));
app.use('/js', express.static(__dirname + '/../common'));
app.use(express.static(__dirname + '/../templates'));
app.use('/scraper', express.static(__dirname + '/../scraper'));

/**
 * /scraper/fetchImage?url={url}
 * 
 * Download image.
 * 
 * @param url URL of image to retrieve
 * 
 * @see Image
 */
app.get('/scraper/fetchImage', function(req, res, next) {
    var url = req.query.url;
    var provider = req.query.provider;
    var id = req.query.id;

    // TODO URL validation?
    // Fetch & store remote data.
    request({url: url, encoding: 'binary'}, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            console.log("Got remote image", url);
        }
    }).pipe(res);
});


/**
 * /savePage
 * 
 * Store the posted PDF data into the *Page* collection.
 * 
 * @see SavedPage
 */
app.post('/savePage', function(req, res, next) {
    var contentType = req.get('Content-Type');
    var contentLength = req.get('Content-Length');
    var caller = req.get('X-Scrape-App');
    var filename = req.query.filename;
    var provider = filename.split('-')[0];
    
    // Basic validation.
    try {
        if (!scraper.providers[provider]) throw "Unknown provider";

        if (filename.length > maxFilenameLength) throw "File name too long";
        
        if (contentLength > maxFileSize) throw "File too large";
    } catch (e) {
        console.log(e);
        return res.status(400).end();
    }

    // Save page data into DB.
    req.on('data', function(data) {
        SavedPage.findOne({filename: filename}, function(err, savedPage) {
            if (err) return next(err);
            
            if (savedPage) {
                // Existing entry, do nothing but don't report error either.
                console.warn("Page already saved to MongoDB", filename);
                return res.status(202).end('OK');
            } else {
                // Create new entry.
                savedPage = new SavedPage;
                savedPage.caller = caller;
                savedPage.provider = provider;
                savedPage.filename = filename;
                savedPage.contentType = contentType;
                savedPage.data = data;
                savedPage.save(function (err) {
                    if (err) return next(err);
                    console.log("Saved page to MongoDB", filename);
                    return res.status(201).end('OK');
                });
            }
        });
    });
});

/**
 * /history?since={date}&caller={string}
 * 
 * Return latest entries in the bookmarks table, optionnally since the given
 * date (excluded), most recent first.
 * 
 * TODO use SavedPage instead
 *
 * @see Bookmark
 * @see /scraper/bookmarkSeed
 */
app.get('/history', function(req, res, next) {
    // Basic validation.
    var since = req.query.since;
    try {
        if (typeof(since) !== 'undefined' && isNaN(Date.parse(since))) throw "Unrecognized date format";
    } catch (e) {
        console.log(e);
        return res.status(400).end();
    }
    
    var caller = req.query.caller;
    
    var query = Bookmark.find()
            .select({_id: 0, date: 1, caller: 1, provider: 1, id: 1, seed: 1})
            .limit(100)
            .sort({date: -1});
    if (since) {
        query.where({date: {$gt: since}});
    }
    if (caller) {
        query.where({caller: caller});
    }
    query.exec(function(err, bookmarks) {
        if (err) return next(err);

        res.send(bookmarks);
    });
});

/**
 * mainPageTpl
 * 
 * Template file for main HTML page.
 */
var mainPageTpl = swig.compileFile('../client/grocery-portraits.html');

/**
 * /
 * 
 * Application root.
 */
app.get('/', function(req, res) {
    res.send(mainPageTpl({
        providers: providers, 
        fields: templates.fields,
        templates: templates.templates,
    }));
});

/**
 * randomPageTpl
 * 
 * Template file for /random HTML page.
 */
var randomPageTpl = swig.compileFile('../client/random.html');

/**
 * /random
 * 
 * Random page viewer.
 */
app.get('/random', function(req, res) {
    res.send(randomPageTpl());
});

/**
 * /random.pdf
 * 
 * Pick & redirect to random page.
 */
app.get('/random.pdf', function(req, res, next) {
    // Try to find scrape with nonempty bookmark list.
    var find = function() {
        // Random seed value used to select the scrape.
        var seed = generateRandomSeed();
        
        //TODO use SavedPage instead
        ScraperResult.findOne({seed: {$gte: seed}, $nor: [ {bookmarks: {$exists: false}}, {bookmarks: {$size: 0}} ]}, "provider id bookmarks", function(err, result) {
            if (err) return next(err);

            if (!result) {
                // Try again.
                find();
                return;
            }
            
            // Found, pick a random bookmarked seed.
            var params = {}
            params.provider = result.provider;
            params.id = result.id;
            params.seed = result.bookmarks[Math.floor(Math.random() * result.bookmarks.length)];
            
            // Choose random template and color.
            var templateNames = Object.keys(templates.templates);
            params.template = templateNames[Math.floor(Math.random() * templateNames.length)];
            var colors = ["black", "red", "blue"];
            params.color = colors[Math.floor(Math.random() * colors.length)];
            
            // Redirect to PDF permalink.
            var pdfURL = 
                      '/' + encodeURIComponent(params.provider) 
                    + '/' + encodeURIComponent(params.id)
                    + '/' + encodeURIComponent(params.template) + '.pdf'
                    + '?randomize=' + params.seed
                    + '&color=' + params.color;
            res.writeHead(307, {
                'Location': pdfURL,
                'Pragma': 'no-cache'
            });
            res.end();
        });
    };
    find();
});

/**
 * piFeedPageTpl
 * 
 * Template file for /pi-feed HTML page.
 */
var piFeedPageTpl = swig.compileFile('../client/pi-feed.html');

/**
 * /pi-feed
 * 
 * PI feed page viewer.
 */
app.get('/pi-feed', function(req, res) {
    res.send(piFeedPageTpl({
        templateNames: JSON.stringify(Object.keys(templates.templates)),
    }));
});

/**
 * server
 * 
 * HTTP server instance.
 */
var server = app.listen(3001, function () {
  var host = server.address().address;
  var port = server.address().port;

  console.log('Grocery Portraits app listening on http://%s:%s', host, port);
});
