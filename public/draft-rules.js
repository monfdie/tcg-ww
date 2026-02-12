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
    // Generals 2 (бывший Heavy Ban)
    // 6 Банов, 3 Пика
    'generals_2': [
        { team: 'blue', type: 'ban' },
        { team: 'red', type: 'ban' },
        { team: 'blue', type: 'ban' },
        { team: 'blue', type: 'ban' },
        { team: 'red', type: 'ban' },
        { team: 'red', type: 'ban' },
        { team: 'blue', type: 'ban' },
        { team: 'blue', type: 'pick' },
        { team: 'red', type: 'ban' },
        { team: 'red', type: 'ban' },
        { team: 'red', type: 'pick' },
        { team: 'blue', type: 'ban' },
        { team: 'blue', type: 'ban' },
        { team: 'blue', type: 'pick' },
        { team: 'red', type: 'ban' },
        { team: 'red', type: 'pick' },
        { team: 'red', type: 'pick' },
        { team: 'blue', type: 'pick' }
    ]
};

// Генерация схемы GITCG CUP 2
const gitcg2 = JSON.parse(JSON.stringify(DRAFT_RULES['gitcg']));
gitcg2[13].immunity = true; 
gitcg2[14].immunity = true;
gitcg2[25].immunity = true; 
gitcg2[27].immunity = true;
DRAFT_RULES['gitcg_cup_2'] = gitcg2;

const IMMUNITY_ORDER = [
    { team: 'blue', type: 'immunity_ban' },
    { team: 'red', type: 'immunity_ban' },
    { team: 'blue', type: 'immunity_pick' },
    { team: 'red', type: 'immunity_pick' }
];

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DRAFT_RULES, IMMUNITY_ORDER };
} else {
    window.DRAFT_RULES = DRAFT_RULES;
    window.IMMUNITY_ORDER = IMMUNITY_ORDER;
}
