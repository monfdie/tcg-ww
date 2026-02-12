<%- include('../partials/header') %>

<style>
    /* --- СТИЛИ ДРАФТА --- */
    .page-container {
        padding: 0 !important; max-width: 100% !important; height: 100%; display: flex; flex-direction: column;
    }

    /* --- НОВЫЕ СТИЛИ ДЛЯ MATCH SUMMARY --- */
    .summary-btn {
        position: fixed; bottom: 20px; right: 20px; z-index: 1000;
        background: linear-gradient(90deg, #d4af37, #f2d05e);
        border: 2px solid #fff; color: #000; font-family: 'Cinzel', serif;
        font-weight: bold; padding: 10px 25px; border-radius: 30px;
        box-shadow: 0 0 20px rgba(212, 175, 55, 0.6); cursor: pointer;
        font-size: 1.2em; display: none; /* Скрыта по умолчанию */
        animation: popIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }
    .summary-btn:hover { transform: scale(1.05); filter: brightness(1.1); }
    @keyframes popIn { from { transform: scale(0); opacity: 0; } to { transform: scale(1); opacity: 1; } }

    .summary-overlay {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0, 0, 0, 0.9); z-index: 2000;
        display: none; align-items: center; justify-content: center;
        backdrop-filter: blur(8px); opacity: 0; transition: opacity 0.3s;
    }
    .summary-overlay.open { display: flex; opacity: 1; }

    /* КАРТОЧКА РЕЗУЛЬТАТОВ (ДЛЯ СКРИНШОТА) */
    .summary-card {
        width: 800px; background: #121520;
        border: 2px solid #3c4566; border-radius: 10px;
        box-shadow: 0 0 60px rgba(0,0,0,0.8);
        position: relative; overflow: hidden;
        background-image: radial-gradient(circle at 50% 0%, #2b3454 0%, #0b0d17 70%);
        padding-bottom: 20px;
    }
    .summary-header {
        text-align: center; padding: 20px;
        border-bottom: 1px solid #3c4566;
        background: rgba(0,0,0,0.3);
    }
    .summary-title {
        font-family: 'Cinzel', serif; font-size: 2.5em; color: #d4af37;
        text-shadow: 0 0 15px rgba(212, 175, 55, 0.4); margin: 0;
    }
    .summary-subtitle {
        font-family: 'Segoe UI', sans-serif; color: #8da4c4; font-size: 1.1em;
        margin-top: 5px; text-transform: uppercase; letter-spacing: 2px;
    }

    .match-rows { padding: 30px; display: flex; flex-direction: column; gap: 20px; }
    
    .match-row {
        display: flex; align-items: center; justify-content: space-between;
        background: rgba(255, 255, 255, 0.03); border: 1px solid #2a3454;
        border-radius: 8px; padding: 10px 30px; height: 100px;
        transition: 0.3s;
    }
    .match-row:hover { background: rgba(255, 255, 255, 0.06); border-color: #4facfe; }

    .player-side { display: flex; align-items: center; gap: 20px; width: 40%; }
    .player-side.right { flex-direction: row-reverse; text-align: right; }
    
    .char-slot {
        width: 80px; height: 80px; border-radius: 50%; background: #000;
        border: 2px dashed #444; position: relative; cursor: pointer;
        overflow: hidden; transition: 0.2s;
    }
    .char-slot:hover { border-color: #aaa; transform: scale(1.05); }
    .char-slot img { width: 100%; height: 100%; object-fit: cover; }
    .char-slot.empty::after { content: '+'; color: #444; font-size: 40px; position: absolute; top:50%; left:50%; transform:translate(-50%, -55%); }

    .score-display {
        font-family: 'Cinzel', serif; font-size: 2.5em; color: #555;
        cursor: pointer; user-select: none; width: 20%; text-align: center;
        transition: 0.2s;
    }
    .score-display:hover { color: #fff; text-shadow: 0 0 10px #fff; }
    
    /* Стили победителя */
    .match-row.blue-win .score-display { color: #4facfe; text-shadow: 0 0 15px rgba(79, 172, 254, 0.6); }
    .match-row.blue-win .player-side.left .char-slot { border: 2px solid #4facfe; box-shadow: 0 0 15px rgba(79, 172, 254, 0.4); }
    .match-row.red-win .score-display { color: #ff6b6b; text-shadow: 0 0 15px rgba(255, 107, 107, 0.6); }
    .match-row.red-win .player-side.right .char-slot { border: 2px solid #ff6b6b; box-shadow: 0 0 15px rgba(255, 107, 107, 0.4); }

    .player-label { font-family: 'Cinzel', serif; font-size: 1.2em; color: #ccc; }
    
    .close-summary {
        position: absolute; top: 15px; right: 20px; font-size: 30px; color: #555;
        cursor: pointer; transition: 0.2s;
    }
    .close-summary:hover { color: #fff; }

    /* Мини-пикер персонажей */
    .char-picker-modal {
        position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
        background: #1a1e2e; border: 1px solid #4facfe; padding: 20px;
        border-radius: 8px; z-index: 3000; display: none;
        box-shadow: 0 0 30px #000; width: 400px;
        flex-wrap: wrap; gap: 10px; justify-content: center;
    }
    .picker-option { width: 60px; height: 60px; border-radius: 50%; cursor: pointer; border: 2px solid transparent; }
    .picker-option:hover { transform: scale(1.1); border-color: #fff; }
    .picker-option img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }

</style>

<div id="game-screen">
    <div class="game-header">
         <div id="room-container">
             <div id="room-display" onclick="copyRoomCode()" title="Click to copy room code">CODE: <%= roomId %></div>
             <span id="copy-toast">Code Copied!</span>
         </div>
         <div class="reserve-timer blue-res"><span id="blue-res">3:00</span></div>
         <div id="status">Waiting...</div>
         <div class="reserve-timer red-res"><span id="red-res">3:00</span></div>
     </div>

     <div class="draft-area">
         <div id="immunity-top-display" class="immunity-top-container" style="display: none;">
             <div class="im-label">IMMUNE</div>
             <div class="im-row" id="immunity-icons-row"></div>
         </div>

         <div class="team-side blue-side">
             <div class="player-header">
                 <div id="blue-timer" class="turn-timer">45</div>
                 <h2 id="blue-name-display">PLAYER 1</h2>
                 <div id="blue-ready-switch" class="ready-switch" onclick="toggleReady('blue')">
                     <div class="switch-circle"></div>
                 </div>
             </div>
             <div class="ban-row" id="blue-bans"></div>
             <div class="pick-row" id="blue-picks-1"></div>
             <div class="pick-row-small" id="blue-picks-2"></div>
         </div>

         <div class="center-axis">
             <div class="mid-label ban-label">BANS</div>
             <div class="mid-label pick-label">PICKS</div>
         </div>

         <div class="team-side red-side">
             <div class="player-header">
                 <div id="red-ready-switch" class="ready-switch" onclick="toggleReady('red')">
                     <div class="switch-circle"></div>
                 </div>
                 <h2 id="red-name-display">PLAYER 2</h2>
                 <div id="red-timer" class="turn-timer">45</div>
             </div>
             <div class="ban-row" id="red-bans"></div>
             <div class="pick-row" id="red-picks-1"></div>
             <div class="pick-row-small" id="red-picks-2"></div>
         </div>
     </div>

     <div class="controls-area">
         <button id="skip-btn" class="round-btn" onclick="skipTurn()">SKIP</button>
         <button id="confirm-btn" class="confirm-btn round-btn" onclick="confirmSelection()" disabled>SELECT</button>
     </div>

     <div class="char-pool" id="char-pool-container"></div>
 </div>

 <button id="open-summary-btn" class="summary-btn" onclick="toggleSummary()">🏆 MATCH SUMMARY</button>

 <div id="summary-overlay" class="summary-overlay">
     <div class="summary-card">
         <span class="close-summary" onclick="toggleSummary()">×</span>
         <div class="summary-header">
             <h1 class="summary-title">GITCG CUP</h1>
             <div class="summary-subtitle">Official Match Result</div>
         </div>
         
         <div class="match-rows">
            <div class="match-row" id="match-row-0">
                <div class="player-side left">
                    <div class="char-slot empty" onclick="openCharPicker(0, 'blue')"></div>
                    <span class="player-label blue-name-sum">Player 1</span>
                </div>
                <div class="score-display" onclick="toggleWinner(0)">VS</div>
                <div class="player-side right">
                    <div class="char-slot empty" onclick="openCharPicker(0, 'red')"></div>
                    <span class="player-label red-name-sum">Player 2</span>
                </div>
            </div>
            <div class="match-row" id="match-row-1">
                <div class="player-side left">
                    <div class="char-slot empty" onclick="openCharPicker(1, 'blue')"></div>
                    <span class="player-label blue-name-sum">Player 1</span>
                </div>
                <div class="score-display" onclick="toggleWinner(1)">VS</div>
                <div class="player-side right">
                    <div class="char-slot empty" onclick="openCharPicker(1, 'red')"></div>
                    <span class="player-label red-name-sum">Player 2</span>
                </div>
            </div>
            <div class="match-row" id="match-row-2">
                <div class="player-side left">
                    <div class="char-slot empty" onclick="openCharPicker(2, 'blue')"></div>
                    <span class="player-label blue-name-sum">Player 1</span>
                </div>
                <div class="score-display" onclick="toggleWinner(2)">VS</div>
                <div class="player-side right">
                    <div class="char-slot empty" onclick="openCharPicker(2, 'red')"></div>
                    <span class="player-label red-name-sum">Player 2</span>
                </div>
            </div>
         </div>
     </div>
     
     <div id="char-picker" class="char-picker-modal"></div>
 </div>

 <script src="/socket.io/socket.io.js"></script>
 <script src="/draft-rules.js"></script>

 <script>
     const socket = io({ transports: ['websocket'] });
     const currentRoom = '<%= roomId %>';
     const myUserId = sessionStorage.getItem('draft_user_id') || Math.random().toString(36).substring(2);
     const myNickname = sessionStorage.getItem('draft_nickname') || 'Player'; // Получаем ник
     
     sessionStorage.setItem('draft_user_id', myUserId);
     
     let myRole = '', currentDraftType = 'gitcg';
     let charsData = {}, selectedCharId = null, isGameStarted = false, activeTeam = 'blue';
     
     let globalState = null;
     let pickerContext = { gameIndex: 0, team: '' };

     socket.on('connect', () => {
         if (currentRoom && myUserId) {
             // ОТПРАВЛЯЕМ НИКНЕЙМ, чтобы сервер мог нас посадить в слот
             socket.emit('rejoin_game', { roomId: currentRoom, userId: myUserId, nickname: myNickname });
         }
     });

     socket.on('error_msg', (msg) => {
         if (msg === 'Session expired' || msg === 'Room not found') {
             alert("Game session expired or not found.");
             window.location.href = "/"; 
         } else {
             alert(msg);
         }
     });

     socket.on('init_game', (data) => {
         myRole = data.role; 
         charsData = data.chars;
         currentDraftType = data.state.draftType || 'gitcg';
         document.getElementById('room-display').innerText = `CODE: ${currentRoom}` + (myRole === 'spectator' ? " (SPEC)" : "");
         
         renderRows(); 
         updateUI(data.state);
     });

     socket.on('update_state', updateUI);
     socket.on('game_started', () => { isGameStarted = true; });
     socket.on('game_over', (state) => { 
         updateUI(state); 
         setTimeout(() => {
            alert("Draft Completed! Fill in the Match Results.");
            toggleSummary(); 
         }, 500); 
     });
     
     socket.on('timer_tick', (data) => {
         const t = typeof data === 'object' ? data.main : data;
         const b = document.getElementById('blue-timer'), r = document.getElementById('red-timer');
         if(activeTeam==='blue') { b.innerText=t; r.innerText="45"; b.style.color=t<10?'#ff5555':'#4facfe'; }
         else { r.innerText=t; b.innerText="45"; r.style.color=t<10?'#ff5555':'#ff6b6b'; }
         if(typeof data === 'object') {
             document.getElementById('blue-res').innerText = formatTime(data.blueReserve);
             document.getElementById('red-res').innerText = formatTime(data.redReserve);
         }
     });

     function formatTime(s) { 
         if (s < 0) s = 0;
         const m=Math.floor(s/60), sec=s%60; 
         return `${m}:${sec<10?'0':''}${sec}`; 
     }

     function toggleReady(r) { if(myRole===r) socket.emit('player_ready', currentRoom); }
     
     function copyRoomCode() { 
         if (!currentRoom) return;
         navigator.clipboard.writeText(currentRoom).then(() => {
             const toast = document.getElementById('copy-toast');
             toast.classList.add('show');
             setTimeout(() => { toast.classList.remove('show'); }, 2000);
         });
     }
     
     function skipTurn() { if(currentRoom) socket.emit('skip_action', currentRoom); }
     
     function renderRows() {
         const container = document.getElementById('char-pool-container');
         container.innerHTML = '';
         const ladder = document.createElement('div'); ladder.className = 'ladder-container';
         const schema = DRAFT_RULES[currentDraftType];
         if(schema) {
             schema.forEach((step, i) => {
                 const d = document.createElement('div');
                 const sideClass = step.team === 'blue' ? 'step-left' : 'step-right';
                 let colorClass = 'step-pick'; 
                 if (step.type.includes('ban')) { colorClass = 'step-ban'; } 
                 else if (step.immunity) { colorClass = 'step-immunity'; }
                 d.className = `ladder-step ${sideClass} ${colorClass}`;
                 d.id = `step-node-${i}`; d.innerText = `${i+1}. ${step.type}`;
                 ladder.appendChild(d);
             });
             container.appendChild(ladder);
         }

         ['cryo','hydro','pyro','electro','anemo','geo','dendro'].forEach(elem => {
             const row = document.createElement('div'); row.className = `element-row row-${elem}`;
             const chars = charsData[elem], mid = Math.ceil(chars.length/2);
             const l = document.createElement('div'); l.className = 'row-half left-half';
             chars.slice(0,mid).forEach(c => l.appendChild(createChar(c)));
             const gap = document.createElement('div'); gap.className = 'row-gap';
             const r = document.createElement('div'); r.className = 'row-half right-half';
             chars.slice(mid).forEach(c => r.appendChild(createChar(c)));
             row.appendChild(l); row.appendChild(gap); row.appendChild(r);
             container.appendChild(row);
         });
     }

     function createChar(char) {
         const el = document.createElement('div');
         el.className = 'char-option'; el.id = `char-${char.id}`;
         el.innerHTML = `<img src="${char.img}">`;
         el.onclick = () => {
             if(!isGameStarted || myRole === 'spectator') return;
             document.querySelectorAll('.char-option').forEach(c => c.classList.remove('selected-pending'));
             selectedCharId = char.id; el.classList.add('selected-pending');
             document.getElementById('confirm-btn').disabled = false;
         };
         return el;
     }

     function confirmSelection() {
         if(selectedCharId && currentRoom) {
             socket.emit('action', { roomId: currentRoom, charId: selectedCharId });
             selectedCharId = null; document.getElementById('confirm-btn').disabled = true;
             document.querySelectorAll('.char-option').forEach(c => c.classList.remove('selected-pending'));
         }
     }

     function updateImmunityTop(state) {
         const topDisp = document.getElementById('immunity-top-display');
         if(state.draftType !== 'gitcg_cup_2') { topDisp.style.display = 'none'; return; }
         topDisp.style.display = 'flex';
         const row = document.getElementById('immunity-icons-row');
         row.innerHTML = '';
         const bans = state.immunityBans || [];
         const picks = state.immunityPool || [];
         const slots = [ { val: bans[0], type: 'ban' }, { val: picks[0], type: 'pick' }, { val: picks[1], type: 'pick' }, { val: bans[1], type: 'ban' } ];
         slots.forEach(slot => {
             const div = document.createElement('div');
             div.className = `im-icon im-${slot.type}`;
             if (slot.val === 'skipped') {
                 div.innerHTML = `<span style="color:#aaa; font-size:20px; line-height:36px; display:block; text-align:center;">✖</span>`;
                 div.style.background = '#222';
             } else if (slot.val) {
                 let all = []; Object.values(charsData).forEach(a => all.push(...a));
                 const char = all.find(c => c.id === slot.val);
                 if(char) div.innerHTML = `<img src="${char.img}">`;
             } else div.classList.add('im-empty');
             row.appendChild(div);
         });
     }

     function updateUI(state) {
         globalState = state;
         isGameStarted = state.gameStarted;
         activeTeam = state.currentTeam;
         
         // Кнопка Summary
         const isEnd = state.stepIndex >= DRAFT_RULES[currentDraftType].length;
         const isCup = (state.draftType === 'gitcg' || state.draftType === 'gitcg_cup_2');
         if (isEnd && isCup) {
             document.getElementById('open-summary-btn').style.display = 'block';
         }

         document.getElementById('blue-ready-switch').style.display = state.gameStarted?'none':'flex';
         document.getElementById('red-ready-switch').style.display = state.gameStarted?'none':'flex';
         if(!state.gameStarted) {
             state.ready.blue ? document.getElementById('blue-ready-switch').classList.add('ready-on') : document.getElementById('blue-ready-switch').classList.remove('ready-on');
             state.ready.red ? document.getElementById('red-ready-switch').classList.add('ready-on') : document.getElementById('red-ready-switch').classList.remove('ready-on');
         }
         
         const blueName = state.blueName || 'Player 1';
         const redName = state.redName || 'Player 2';
         document.getElementById('blue-name-display').innerText = blueName;
         document.getElementById('red-name-display').innerText = redName;
         
         document.querySelectorAll('.blue-name-sum').forEach(el => el.innerText = blueName);
         document.querySelectorAll('.red-name-sum').forEach(el => el.innerText = redName);

         let txt = "WAITING...";
         if(state.immunityPhaseActive) txt = `IMMUNITY: ${state.currentTeam} ${state.currentAction}`;
         else if(state.gameStarted) txt = `${state.currentTeam} IS ${state.currentAction==='ban'?'BANNING':'PICKING'}`;
         else if(isEnd) txt = "DRAFT COMPLETED";
         document.getElementById('status').innerText = txt.toUpperCase();

         updateImmunityTop(state);

         const skipBtn = document.getElementById('skip-btn');
         const isMyTurn = (myRole === state.currentTeam);
         skipBtn.classList.remove('skip-left', 'skip-right');
         if (state.immunityPhaseActive && isMyTurn) {
             skipBtn.style.display = 'block';
             if (state.currentTeam === 'blue') skipBtn.classList.add('skip-left');
             else skipBtn.classList.add('skip-right');
         } else {
             skipBtn.style.display = 'none';
         }

         const idx = state.stepIndex - 1;
         const currentSchema = DRAFT_RULES[currentDraftType];
         if(!state.immunityPhaseActive && currentSchema) {
             const len = currentSchema.length;
             for(let i=0; i<len; i++) {
                 const n = document.getElementById(`step-node-${i}`);
                 if(!n) continue;
                 n.classList.remove('step-active','step-done');
                 if(i < idx) n.classList.add('step-done');
                 else if(i === idx && state.gameStarted) {
                     n.classList.add('step-active');
                     setTimeout(() => n.scrollIntoView({behavior:'smooth', block:'center'}), 50);
                 }
             }
         }

         renderSlots(state);
         document.querySelectorAll('.char-option').forEach(el => el.classList.remove('disabled', 'immunity-highlight'));
         state.bans.forEach(b => document.getElementById(`char-${b.id}`)?.classList.add('disabled'));
         [...state.bluePicks, ...state.redPicks].forEach(id => document.getElementById(`char-${id}`)?.classList.add('disabled'));
         
         if (state.matchResults) updateSummaryVisuals(state.matchResults);
         
         // Блокировка для зрителей или не своего хода
         if(state.gameStarted && myRole !== 'spectator' && myRole !== state.currentTeam) {
             document.querySelectorAll('.char-option').forEach(el => el.classList.add('disabled'));
         }
         if(myRole === 'spectator') {
             document.querySelectorAll('.char-option').forEach(el => el.classList.add('disabled'));
         }
     }

     function getStepsFor(schema, team, type) {
         if (!schema) return [];
         return schema
             .map((step, index) => ({ ...step, globalIndex: index + 1 }))
             .filter(step => step.team === team && step.type === type)
             .map(step => ({ num: step.globalIndex, immunity: step.immunity }));
     }

     function renderSlots(state) {
         const currentSchema = DRAFT_RULES[currentDraftType];
         if (!currentSchema) return;
         const blueBanSteps = getStepsFor(currentSchema, 'blue', 'ban');
         const redBanSteps = getStepsFor(currentSchema, 'red', 'ban');
         const bluePickSteps = getStepsFor(currentSchema, 'blue', 'pick');
         const redPickSteps = getStepsFor(currentSchema, 'red', 'pick');
         const fill = (containerId, items, stepData, isBan) => {
             const div = document.getElementById(containerId);
             if(!div) return;
             div.innerHTML = ''; 
             stepData.forEach((step, i) => {
                 const slot = document.createElement('div');
                 slot.className = 'slot-circle';
                 if (isBan) slot.classList.add('slot-ban');
                 if (step.immunity) slot.classList.add('slot-immunity-pick');
                 if (!state.immunityPhaseActive && state.gameStarted && step.num === state.stepIndex) {
                     slot.classList.add('active-slot');
                 }
                 let charId = null;
                 if (items[i]) charId = typeof items[i] === 'object' ? items[i].id : items[i];
                 if (charId) {
                     let allFlat = []; Object.values(charsData).forEach(arr => allFlat.push(...arr));
                     const char = allFlat.find(c => c.id === charId);
                     if (char) slot.innerHTML = `<img src="${char.img}">`;
                 } else slot.innerHTML = `<span class="step-number">${step.num}</span>`;
                 div.appendChild(slot);
            });
         };
         fill('blue-bans', state.bans.filter(b => b.team === 'blue'), blueBanSteps, true);
         fill('red-bans', state.bans.filter(b => b.team === 'red'), redBanSteps, true);
         if (currentDraftType === 'generals_2') {
             fill('blue-picks-1', state.bluePicks, bluePickSteps, false);
             fill('blue-picks-2', [], [], false); 
             fill('red-picks-1', state.redPicks, redPickSteps, false);
             fill('red-picks-2', [], [], false);
         } else if (currentDraftType === 'classic') {
             fill('blue-picks-1', state.bluePicks, bluePickSteps, false);
             fill('blue-picks-2', [], [], false);
             fill('red-picks-1', state.redPicks, redPickSteps, false);
             fill('red-picks-2', [], [], false);
         } else {
             fill('blue-picks-1', state.bluePicks.slice(0, 5), bluePickSteps.slice(0, 5), false);
             fill('blue-picks-2', state.bluePicks.slice(5, 9), bluePickSteps.slice(5, 9), false);
             fill('red-picks-1', state.redPicks.slice(0, 5), redPickSteps.slice(0, 5), false);
             fill('red-picks-2', state.redPicks.slice(5, 9), redPickSteps.slice(5, 9), false);
         }
     }

     function toggleSummary() {
         const overlay = document.getElementById('summary-overlay');
         overlay.classList.toggle('open');
         document.getElementById('char-picker').style.display = 'none';
     }

     function toggleWinner(gameIndex) {
         if (!currentRoom) return;
         const res = globalState.matchResults[gameIndex];
         let nextWin = null;
         if (!res.winner) nextWin = 'blue';
         else if (res.winner === 'blue') nextWin = 'red';
         else nextWin = null;
         
         socket.emit('update_results', { roomId: currentRoom, gameIndex, field: 'winner', value: nextWin });
     }

     function openCharPicker(gameIndex, team) {
         pickerContext = { gameIndex, team };
         const picker = document.getElementById('char-picker');
         picker.innerHTML = '';
         picker.style.display = 'flex';
         
         const pool = (team === 'blue') ? globalState.bluePicks : globalState.redPicks;
         
         const empty = document.createElement('div');
         empty.innerText = "✖";
         empty.style.color = "#fff"; empty.style.fontSize = "30px"; empty.style.textAlign = "center"; empty.style.lineHeight = "60px";
         empty.className = 'picker-option';
         empty.onclick = () => selectSummaryChar(null);
         picker.appendChild(empty);

         pool.forEach(id => {
             let allFlat = []; Object.values(charsData).forEach(arr => allFlat.push(...arr));
             const char = allFlat.find(c => c.id === id);
             if (char) {
                 const d = document.createElement('div');
                 d.className = 'picker-option';
                 d.innerHTML = `<img src="${char.img}">`;
                 d.onclick = () => selectSummaryChar(id);
                 picker.appendChild(d);
             }
         });
     }

     function selectSummaryChar(charId) {
         socket.emit('update_results', { 
             roomId: currentRoom, 
             gameIndex: pickerContext.gameIndex, 
             field: pickerContext.team + 'Char', 
             value: charId 
         });
         document.getElementById('char-picker').style.display = 'none';
     }

     function updateSummaryVisuals(results) {
         results.forEach((res, i) => {
             const row = document.getElementById(`match-row-${i}`);
             const blueSlot = row.querySelector('.player-side.left .char-slot');
             const redSlot = row.querySelector('.player-side.right .char-slot');
             const score = row.querySelector('.score-display');
             
             updateSlotImg(blueSlot, res.blueChar);
             updateSlotImg(redSlot, res.redChar);
             
             row.classList.remove('blue-win', 'red-win');
             if (res.winner === 'blue') {
                 row.classList.add('blue-win');
                 score.innerText = "1 - 0";
             } else if (res.winner === 'red') {
                 row.classList.add('red-win');
                 score.innerText = "0 - 1";
             } else {
                 score.innerText = "VS";
             }
         });
     }

     function updateSlotImg(slot, charId) {
         slot.innerHTML = '';
         slot.className = 'char-slot'; 
         if (charId) {
             let allFlat = []; Object.values(charsData).forEach(arr => allFlat.push(...arr));
             const char = allFlat.find(c => c.id === charId);
             if (char) {
                 slot.innerHTML = `<img src="${char.img}">`;
                 slot.classList.remove('empty');
             }
         } else {
             slot.classList.add('empty');
         }
     }

 </script>

<%- include('../partials/footer') %>
