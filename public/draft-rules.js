// public/draft-rules.js

const DRAFT_RULES = {
    'gitcg': [
        { team: 'blue', type: 'ban' }, { team: 'blue', type: 'ban' },
        { team: 'red', type: 'ban' },  { team: 'red', type: 'ban' },
        { team: 'blue', type: 'ban' }, 
        { team: 'blue', type: 'pick' },
        { team: 'red', type: 'pick' }, { team: 'red', type: 'pick' },
        { team: 'blue', type: 'pick' }, { team: 'blue', type: 'pick' },
        { team: 'red', type: 'ban' }, 
        { team: 'red', type: 'pick' },
        { team: 'blue', type: 'ban' }, 
        { team: 'blue', type: 'pick' }, 
        { team: 'red', type: 'pick' }, { team: 'red', type: 'pick' },
        { team: 'blue', type: 'pick' }, { team: 'blue', type: 'pick' },
        { team: 'red', type: 'ban' }, 
        { team: 'red', type: 'pick' },
        { team: 'blue', type: 'ban' }, 
        { team: 'blue', type: 'pick' },
        { team: 'red', type: 'ban' }, 
        { team: 'red', type: 'pick' },
        { team: 'blue', type: 'pick' }, { team: 'blue', type: 'pick' },
        { team: 'red', type: 'pick' }, { team: 'red', type: 'pick' }
    ],
    'classic': [
        { team: 'blue', type: 'ban' }, { team: 'red', type: 'ban' },       
        { team: 'red', type: 'pick' }, { team: 'blue', type: 'ban' },      
        { team: 'blue', type: 'pick' }, { team: 'red', type: 'ban' },       
        { team: 'red', type: 'pick' }, { team: 'blue', type: 'pick' },     
        { team: 'blue', type: 'pick' }, { team: 'red', type: 'pick' }       
    ],
    'generals_2': [
        { team: 'blue', type: 'ban' }, { team: 'red', type: 'ban' },
        { team: 'blue', type: 'ban' }, { team: 'blue', type: 'ban' },
        { team: 'red', type: 'ban' },  { team: 'red', type: 'ban' },
        { team: 'blue', type: 'ban' }, { team: 'blue', type: 'pick' },
        { team: 'red', type: 'ban' },  { team: 'red', type: 'ban' },
        { team: 'red', type: 'pick' }, { team: 'blue', type: 'ban' },
        { team: 'blue', type: 'ban' }, { team: 'blue', type: 'pick' },
        { team: 'red', type: 'ban' },  { team: 'red', type: 'pick' },
        { team: 'red', type: 'pick' }, { team: 'blue', type: 'pick' }
    ]
};

// --- СПЕЦИАЛЬНАЯ ЛОГИКА ДЛЯ GITCG CUP 2 ---
// 1. Фаза иммунитета (4 шага)
const IMMUNITY_PHASE = [
    { team: 'blue', type: 'immunity_ban' },  // Запретить брать в имун
    { team: 'red', type: 'immunity_ban' },
    { team: 'blue', type: 'immunity_pick' }, // Выбрать имун
    { team: 'red', type: 'immunity_pick' }
];

// 2. Объединяем: Сначала фаза иммуна, потом обычный драфт gitcg
DRAFT_RULES['gitcg_cup_2'] = [...IMMUNITY_PHASE, ...DRAFT_RULES['gitcg']];

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DRAFT_RULES };
} else {
    window.DRAFT_RULES = DRAFT_RULES;
}
