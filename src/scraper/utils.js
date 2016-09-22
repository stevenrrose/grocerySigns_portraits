/*
 *
 * Utilities.
 *
 */

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


if (typeof(exports) !== 'undefined') {
    module.exports = {
        getTimestamp: getTimestamp
    };
}
