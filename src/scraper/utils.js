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
var getTimestampFromDate = function(date) {
    return Math.floor(date.getTime()/*ms*/ / 1000);
};

/**
 * Get Javascript date from Unix timestamp.
 *
 *  @param timestamp    Unix timestamp.
 *
 *  @return Javascript date = new Date(timestamp * 1000)
 */
var getDateFromTimestamp = function(timestamp) {
    return new Date(timestamp/*s*/ * 1000);
};

if (typeof(exports) !== 'undefined') {
    module.exports = {
        getTimestampFromDate: getTimestampFromDate,
        getDateFromTimestamp: getDateFromTimestamp
    };
}
