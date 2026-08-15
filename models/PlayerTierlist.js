const mongoose = require('mongoose');

const playerTierlistSchema = new mongoose.Schema({
    key: { type: String, default: 'official', unique: true },
    data: { 
        type: Object, 
        default: { t0: [], t1: [], t2: [], t3: [], t4: [], unassigned: [] } 
    }
});

module.exports = mongoose.model('PlayerTierlist', playerTierlistSchema);
