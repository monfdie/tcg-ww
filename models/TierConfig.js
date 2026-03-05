const mongoose = require('mongoose');

const tierConfigSchema = new mongoose.Schema({
    settingsKey: { type: String, default: 'main' },
    limits: { type: Object, default: { "4": 1, "3": 4, "2": 10, "1": 15, "0": 20 } },
    characters: { type: Object, default: {} }
});

module.exports = mongoose.model('TierConfig', tierConfigSchema);
