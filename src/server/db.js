/**
 * DB-related stuff. The DB storage engine is MongoDB, and we use the 
 * Mongoose ODM.
 */

var mongoose = require('mongoose');
mongoose.connect('mongodb://localhost/grocery-portraits');

var Schema = mongoose.Schema;

/**
 * SavedPage
 * 
 * Mongoose model for saved pages.
 * 
 * @property filename page file name
 * @property date date of save op
 * @property caller client application ID
 * @property provider data provider ID (e.g. 'Twitter')
 * @property userId provider-specific user ID
 * @property contentType MIME type of the page file
 * @property data page data
 * 
 * @see /savePage
 */
var savedPageSchema = new Schema({
    filename: { type: String, index: {unique: true} },
    date: { type: Date, default: Date.now},
    caller: String,
    provider: String,
    userId: String,
    contentType: String,
    data: Buffer
});
savedPageSchema.index({date: 1});
savedPageSchema.index({provider: 1});
savedPageSchema.index({provider: 1, date: 1});
savedPageSchema.index({provider: 1, userId: 1});
var SavedPage = mongoose.model('SavedPage', savedPageSchema);

/**
 * Exports.
 */
exports.SavedPage = SavedPage;
