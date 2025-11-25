// client/script.js
const SERVER = "http://localhost:3000"; // change when deployed
const socket = io(SERVER);

let myId = "";
let currentRoom = "";
let myHand = [];
let players = []; // array of {id,name}
let scores = {};
let turnIndex = 0;
let powerhouse = null;
let leaderId = null;

const el = {
  name: () => document.getElementById("name"),
  room: () => document.getElementById("room"),
  joinBtn: () => document.getElementById("joinBtn"),
  playersInfo: () => document.getElementById("playersInfo"),
  hand: () => document.getElementById("hand"),
  playedCards: () => document.getElementById("playedCards"),
  log: () => document.getElementById("log"),
  info: () => document.getElementById("info"),
  scores: () => document.getElementById("scores"),
  powerhouseArea: () => document.getElementById("powerhouseArea")
};

function logMsg(txt) {
  const d = new Date().toLocaleTimeString();
  el.log().innerHTML = `[${d}] ${txt}<br>` + el.log().innerHTML;
}

socket.on("connect", () => {
  myId = socket.id;
  logMsg("Connected: " + myId);
});

el.joinBtn().onclick = () => {
  const name = el.name().value || "";
  const room = el.room().value || "test1";
  currentRoom = room;
  socket.emit("join_room", { roomId: room, name });
  logMsg("Joining room " + room);
};

/* Events from server */
socket.on("room_update", ({ players: ps, scores: sc }) => {
  players = ps; scores = sc || {};
  renderPlayers();
});

socket.on("round_started", ({ handsCount, leaderId: lid }) => {
  leaderId = lid;
  powerhouse = null;
  renderPlayers();
  el.info().innerHTML = `Round started. Leader selects PowerHouse.`;
  // show powerhouse selection only for leader
  showPowerhouseSelector();
});

socket.on("deal_hand", ({ hand, yourId }) => {
  if (yourId === myId) {
    myHand = hand;
    renderHand();
    logMsg("You were dealt " + hand.length + " cards.");
  }
});

socket.on("powerhouse_set", ({ powerhouse: ph }) => {
  powerhouse = ph;
  logMsg("PowerHouse set: " + (ph || "NONE"));
  renderPlayers();
  hidePowerhouseSelector();
});

socket.on("game_state", (state) => {
  players = state.players; scores = state.scores || {}; turnIndex = state.turnIndex; powerhouse = state.powerhouse;
  renderPlayers();
  renderScores();
  renderTurnMarker();
});

socket.on("card_played", ({ playerId, card, trickCount }) => {
  // show card in played area
  const div = createCardElement(card, true);
  const wrapper = document.createElement("div");
  wrapper.style.display = "inline-block";
  wrapper.style.marginRight = "6px";
  wrapper.appendChild(div);
  wrapper.title = (players.find(p=>p.id===playerId)||{}).name || playerId;
  el.playedCards().appendChild(wrapper);
  logMsg((players.find(p=>p.id===playerId)||{}).name + " played " + card.rank + " of " + card.suit);
});

socket.on("trick_complete", ({ winnerId, trick, trickPoints, scores: sc }) => {
  logMsg("Trick complete. Winner: " + (players.find(p=>p.id===winnerId)||{}).name + " (+" + trickPoints + " pts)");
  scores = sc; renderScores();
  // clear played area after a short delay
  setTimeout(()=>{ el.playedCards().innerHTML = ""; }, 1200);
});

socket.on("round_over", ({ scores: sc }) => {
  logMsg("Round over. Scores updated.");
  scores = sc; renderScores();
});

socket.on("invalid_move", ({ reason }) => {
  logMsg("Invalid move: " + reason);
});

/* UI rendering helpers */
function renderPlayers() {
  el.playersInfo().innerHTML = "<b>Players:</b><br>" + players.map((p, idx) => {
    const you = p.id === myId ? " (YOU)" : "";
    const leader = p.id === leaderId ? " [Leader]" : "";
    const turnMark = idx === turnIndex ? " ← TURN" : "";
    return `${p.name || p.id}${you}${leader}${turnMark}`;
  }).join("<br>");
}

function renderScores() {
  el.scores().innerHTML = "<b>Scores</b><br>" + players.map(p => `${p.name || p.id}: ${scores[p.id]||0}`).join("<br>");
}

function renderHand() {
  const handEl = el.hand();
  handEl.innerHTML = "";
  myHand.forEach((card, idx) => {
    const c = createCardElement(card, false);
    // determine if this card is playable
    const canPlay = isPlayable(card);
    if (!canPlay) c.classList.add("disabled");
    c.onclick = () => {
      if (!canPlay) { logMsg("Not playable now"); return; }
      socket.emit("play_card", { roomId: currentRoom, card });
      // optimistic removal: actual server will broadcast state; but remove locally to keep UI snappy
      myHand.splice(idx,1);
      renderHand();
    };
    handEl.appendChild(c);
  });
  // also show number of cards left for players
  // (players' hands counts arrive in game_state or round_started)
}

function createCardElement(card, small=false) {
  const div = document.createElement("div");
  div.className = "card";
  if (small) div.style.width = "64px";
  const suitClass = "suit-" + card.suit;
  const top = document.createElement("div"); top.className = "top " + suitClass; top.innerText = card.rank;
  const center = document.createElement("div"); center.className = "center " + suitClass; center.innerText = suitSymbol(card.suit);
  const bottom = document.createElement("div"); bottom.className = "bottom " + suitClass; bottom.innerText = card.rank;
  div.appendChild(top); div.appendChild(center); div.appendChild(bottom);
  return div;
}

function suitSymbol(suit) {
  switch(suit) {
    case "spades": return "♠";
    case "hearts": return "♥";
    case "diamonds": return "♦";
    case "clubs": return "♣";
  }
  return "?";
}

/* Determine if a card is playable locally:
   - it must be your turn (based on turnIndex & players array)
   - if trick started and you have led suit in hand you must follow (server enforces too)
*/
function isPlayable(card) {
  const myIndex = players.findIndex(p => p.id === myId);
  if (myIndex === -1) return false;
  if (players.length === 0) return false;
  if (myIndex !== turnIndex) return false;
  // check trick led suit: we need to ask server snapshot; we have limited snapshot; but server sends game_state that includes currentTrick
  // for simplicity: allow play if it's your turn. Server will reject illegal plays (and notify)
  return true;
}

/* PowerHouse UI (leader only) */
function showPowerhouseSelector() {
  el.powerhouseArea().innerHTML = "";
  if (!leaderId || leaderId !== myId) {
    el.powerhouseArea().innerHTML = "<small>Waiting for leader to select PowerHouse.</small>";
    return;
  }
  const label = document.createElement("div"); label.innerText = "Select PowerHouse (trump): ";
  const sel = document.createElement("select");
  const noneOpt = document.createElement("option"); noneOpt.value=""; noneOpt.innerText="None"; sel.appendChild(noneOpt);
  ["spades","hearts","diamonds","clubs"].forEach(s => {
    const o = document.createElement("option"); o.value = s; o.innerText = s; sel.appendChild(o);
  });
  const btn = document.createElement("button"); btn.innerText = "Set";
  btn.onclick = () => {
    const val = sel.value || null;
    socket.emit("select_powerhouse", { roomId: currentRoom, suit: val });
  };
  el.powerhouseArea().appendChild(label);
  el.powerhouseArea().appendChild(sel);
  el.powerhouseArea().appendChild(btn);
}

function hidePowerhouseSelector() { el.powerhouseArea().innerHTML = ""; }

/* initial UI */
renderPlayers();
renderScores();
