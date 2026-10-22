const characters = require('../characters.json');
const validIds = new Set(Object.values(characters).flat().map(character => String(character.id)));

function validateGlobalBans(ids, count) {
    if (!Array.isArray(ids) || ids.length !== count || new Set(ids).size !== count ||
        ids.some(id => typeof id !== 'string' || !validIds.has(id))) {
        return false;
    }
    return true;
}

module.exports = { validateGlobalBans, validIds };
