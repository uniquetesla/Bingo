const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const playerId = localStorage.getItem('bingo-player-id') || crypto.randomUUID();
localStorage.setItem('bingo-player-id', playerId);
const state = { name: localStorage.getItem('bingo-name') || '', code: '', mode: 'create', isHost: false, numbers: [], drawn: [], marked: new Set([12]), room: null, playerId };
const socket = io({ reconnection: true });
const heroNumbers = [4,18,33,51,67,12,21,40,56,73,7,29,'★',48,62,9,25,44,59,70,15,30,46,60,75];
$('#heroGrid').innerHTML = heroNumbers.map((n,i)=>`<span class="${[1,8,13,21].includes(i)?'hit':''}">${n}</span>`).join('');

function showScreen(id) { $$('.screen').forEach(screen=>screen.classList.toggle('active',screen.id===id)); window.scrollTo(0,0); }
function initials(name) { return name.split(/\s+/).map(part=>part[0]).join('').slice(0,2).toUpperCase(); }
function escapeHtml(value) { const node=document.createElement('span'); node.textContent=value; return node.innerHTML; }
function updateProfile() { if (!state.name) return; $('#profilePill').hidden=false; $('#headerInitials').textContent=initials(state.name); $('#headerName').textContent=state.name.split(' ')[0]; }
function emit(event, payload={}) { return new Promise(resolve=>socket.emit(event,payload,response=>resolve(response || {ok:false,message:'Der Server antwortet nicht.'}))); }
function saveSession() { localStorage.setItem('bingo-name',state.name); localStorage.setItem('bingo-session',JSON.stringify({code:state.code,playerId})); }
function clearSession() { localStorage.removeItem('bingo-session'); state.code=''; state.room=null; }
let toastTimer; function toast(message) { const node=$('#toast'); node.textContent=message; node.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>node.classList.remove('show'),2600); }

function applyRoom(room) {
  state.room=room; state.code=room.code; state.isHost=room.isHost; state.numbers=room.card; state.drawn=room.drawn; state.marked=new Set(room.marked); saveSession();
  $('#lobbyCode').textContent=room.code; $('#gameCode').textContent=room.code; $('#firstName').textContent=state.name.split(' ')[0];
  if (room.status==='lobby') { renderPlayers(room); renderHostPanel(); showScreen('lobbyScreen'); }
  else { renderBoard(); updateDrawDisplay(); renderHostPanel(); showScreen('gameScreen'); if (room.status==='finished' && room.winnerId) showWinner(room); }
}
function renderPlayers(room) { $('#playerCount').textContent=room.players.length; $('#playersList').innerHTML=room.players.map(player=>`<div class="player-row"><span class="avatar">${escapeHtml(initials(player.name))}</span><div><p>${escapeHtml(player.name)}${player.id===playerId?' (Du)':''}</p><small>${player.id===room.hostId?'Kommandant':'Crewmitglied'}</small></div>${state.isHost&&player.id!==playerId?`<button class="kick-btn" data-player="${player.id}" aria-label="${escapeHtml(player.name)} entfernen">Entfernen</button>`:'<span class="status">● Bereit</span>'}</div>`).join(''); $$('.kick-btn').forEach(button=>button.addEventListener('click',()=>kickPlayer(button.dataset.player))); }
function renderHostPanel() { $('.host-panel h3').textContent=state.isHost?'Du bist Gastgeber':'Warte auf den Gastgeber'; $('.host-panel p').textContent=state.isHost?'Du startest die Mission – danach übernimmt der Autopilot.':'Sobald der Gastgeber startet, erscheint hier deine Karte.'; $('#startGameBtn').hidden=!state.isHost; $('#startGameBtn').disabled=!state.isHost; $('.interval-setting').hidden=!state.isHost; $('#drawInterval').disabled=!state.isHost; $('#drawInterval').value=String(state.room?.drawInterval||10); $('#newRoundBtn').hidden=!state.isHost; $('#newRoundBtn').disabled=!state.isHost; }
function renderBoard() { $('#bingoBoard').innerHTML=state.numbers.map((number,index)=>`<button class="board-cell ${state.marked.has(index)?'marked':''} ${index===12?'free':''}" data-index="${index}"><span>${number}</span></button>`).join(''); $$('.board-cell').forEach(cell=>cell.addEventListener('click',()=>toggleMark(Number(cell.dataset.index)))); }
function updateDrawDisplay() { const current=state.drawn.at(-1); const ball=$('#currentBall'); const changed=ball.textContent!==String(current??'?'); ball.textContent=current??'?'; ball.classList.toggle('empty',!current); if(changed&&current){ball.classList.remove('reveal');void ball.offsetWidth;ball.classList.add('reveal')} $('#drawnCount').textContent=state.drawn.length; $('#callStatus').textContent=current?`${current} ist im Orbit`:'Die erste Zahl ist gleich unterwegs …'; $('#recentBalls').innerHTML=state.drawn.length?state.drawn.slice(-8).reverse().map(n=>`<span>${n}</span>`).join(''):'<span class="muted">Noch keine</span>'; }
function showWinner(room) { const winner=room.players.find(p=>p.id===room.winnerId); $('#winnerName').textContent=winner?.name||'Ein Crewmitglied'; if (!$('#winnerDialog').open) $('#winnerDialog').showModal(); }
async function perform(event,payload={}) { const response=await emit(event,payload); if (!response.ok) { toast(response.message); return null; } return response.state; }
async function toggleMark(index) { if (index===12) return; const room=await perform('card:mark',{index,marked:!state.marked.has(index)}); if (room) applyRoom(room); }

function begin(mode) { state.mode=mode; if(state.name)return openRoomChoice(); showScreen('authScreen'); setTimeout(()=>$('#fullName').focus(),50); }
function openRoomChoice() { const joining=state.mode==='join'; $('#choiceTitle').textContent=joining?'Raum beitreten':'Raum erstellen'; $('#choiceSubtitle').textContent=joining?'Gib den Code deines Gastgebers ein.':'Dein persönlicher Bingo-Abend ist gleich bereit.'; $('#joinForm').hidden=!joining; $('#createPanel').hidden=joining; showScreen('roomChoiceScreen'); if(joining)setTimeout(()=>$('#roomCode').focus(),50); }
$('#createRoomBtn').addEventListener('click',()=>begin('create')); $('#joinRoomBtn').addEventListener('click',()=>begin('join')); $$('[data-back]').forEach(button=>button.addEventListener('click',()=>showScreen(button.dataset.back)));
$('#nameForm').addEventListener('submit',event=>{ event.preventDefault(); const name=$('#fullName').value.trim().replace(/\s+/g,' '); if(name.length<3||!name.includes(' ')){ $('#nameError').textContent='Bitte gib deinen Vor- und Nachnamen ein.'; return; } state.name=name; $('#nameError').textContent=''; updateProfile(); openRoomChoice(); });
$('#roomCode').addEventListener('input',event=>{event.target.value=event.target.value.replace(/\D/g,'').slice(0,4)});
$('#joinForm').addEventListener('submit',async event=>{ event.preventDefault(); const code=$('#roomCode').value; if(!/^\d{4}$/.test(code)){ $('#codeError').textContent='Der Raumcode besteht aus genau 4 Ziffern.'; return; } const room=await perform('room:join',{code,name:state.name,playerId}); if(room){$('#codeError').textContent='';applyRoom(room);} });
$('#confirmCreateBtn').addEventListener('click',async()=>{const room=await perform('room:create',{name:state.name,playerId});if(room)applyRoom(room)});
$('#startGameBtn').addEventListener('click',async()=>{if(!state.isHost)return;const room=await perform('game:start');if(room)applyRoom(room)});
$('#drawInterval').addEventListener('change',async event=>{if(!state.isHost)return;const room=await perform('room:configure',{drawInterval:Number(event.target.value)});if(room)applyRoom(room)});
async function kickPlayer(targetId){if(!confirm('Crewmitglied wirklich entfernen und für diese Lobby sperren?'))return;const room=await perform('room:kick',{playerId:targetId});if(room)applyRoom(room)}
$('#bingoBtn').addEventListener('click',async()=>{const room=await perform('game:bingo');if(room)applyRoom(room)});
$('#newRoundBtn').addEventListener('click',async()=>{if(!state.isHost)return;const room=await perform('game:new-round');if(room){$('#winnerDialog').close();applyRoom(room)}});
$('#copyCodeBtn').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(state.code)}catch{}toast(`Raumcode ${state.code} kopiert`)});
async function goHome(){if(state.code)await emit('room:leave');clearSession();$$('#winnerDialog:modal').forEach(d=>d.close());showScreen('landingScreen')}
$('#winnerLeaveBtn').addEventListener('click',goHome); $('#leaveLobbyBtn').addEventListener('click',goHome); $('#leaveGameBtn').addEventListener('click',goHome);
$('#howBtn').addEventListener('click',()=>$('#howDialog').showModal()); $('.dialog-close').addEventListener('click',()=>$('#howDialog').close()); $('#howDialog').addEventListener('click',event=>{if(event.target===$('#howDialog'))$('#howDialog').close()});
socket.on('room:state',applyRoom); socket.on('room:error',error=>{toast(error.message);clearSession();showScreen('landingScreen')}); socket.on('connect',async()=>{const saved=JSON.parse(localStorage.getItem('bingo-session')||'null');if(saved?.code&&saved.playerId===playerId){const room=await perform('room:resume',saved);if(room)applyRoom(room);else clearSession();}});
updateProfile();
setInterval(()=>{const node=$('#countdown');if(!node||!state.room||state.room.status!=='playing')return;const seconds=Math.max(0,Math.ceil((state.room.nextDrawAt-Date.now())/1000));node.textContent=state.room.nextDrawAt?`Nächste Zahl in ${seconds} Sek.${seconds===1?'':' '}`:'Alle Zahlen sind gezogen';},250);
