/**
 * Umbrella module for client-side scraping JS files.
 */

/*
 * Browser code defines global variables & functions in a global script element.
 * In Node.js the *global* object maps to the global context in each required 
 * file, so define the needed variables as a property of this object.
 */
global.Provider = require('../scraper/provider.js');
global.providers = {};

/*
 * Utilities.
 */
var utils = require('../scraper/utils.js');
for (var key in utils) {
    global[key] = utils[key];
}

/*
 * These files will add their own Provider-based objects to the global *providers* array.
 */
require('../scraper/facebook.js');
require('../scraper/linkedin.js');
require('../scraper/gmail.js');
require('../scraper/twitter.js');

// Exports the above *providers* variable.
exports.providers = global.providers;
