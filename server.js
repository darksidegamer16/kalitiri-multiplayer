// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET","POST"] } });

console.log("\n--- KALITIRI SERVER (no Redis) ---\n");

const RANKS = ["A","K","Q","J","10","9","8","7","6","5","4","3","2"];
const SUITS = ["spades","hearts","diamonds","clubs"];

// Points mapping (KaliTiri)
function cardKey(card) {
  return `${card.rank}-${card.suit}`;
}
function pointsOf(card) {
  if (card.rank === "3" && card.suit === "spades") return 30;
  if (["A","K","Q","J","10"].includes(card.rank)) return 10;
  if (card.rank === "5") return 5;
  return 0;
}

// rank order for comparison (higher value wins)
const rankValue = { "A":13, "K":12, "Q":11, "J":10, "10":9, "9":8, "8":7, "7":6, "6":5, "5":4, "4":3, "3":2, "2":1 };

function generateDeck() {
  const d = [];
  for (let s of SUITS) for (let r of RANKS) d.push({ suit: s, rank: r });
  return d;
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// remove cards to make deck divisible by players: remove 2s first, then 3s, etc.
function reduceDeckToDivisible(deck, playersCount) {
  if (deck.length % playersCount === 0) return deck;
  const removeOrder = ["2","3","4","6","7","8","9","10","J","Q","K","A","5"]; // prefer removing low-impact 2s then 3s
  let working = deck.slice();
  for (let rank of removeOrder) {
    for (let i = working.length - 1; i >= 0; i--) {
      if (working.length % playersCount === 0) return working;
      if (working[i].rank === rank) working.splice(i,1);
    }
  }
  return working;
}

/* =======================
   In-memory game state
   rooms = {
     <roomId>: {
        players: [{id,name}], 
        hands: { playerId: [cards] },
        scores: { playerId: num },
        turnIndex: number, // index into players
        currentTrick: [{ playerId, card }],
        powerhouse: null (suit or null),
        leaderIndex: 0 (who selects powerhouse)
     }
   }
   ======================= */
const rooms = {};

function log(...args) { console.log("[SERVER]", ...args); }

/* Socket handlers */
io.on("connection", (socket) => {
  log("conn:", socket.id);

  socket.on("join_room", ({ roomId, name }) => {
    log("join_room", roomId, name, socket.id);
    if (!roomId) return;
    if (!rooms[roomId]) {
      rooms[roomId] = { players: [], hands: {}, scores: {}, turnIndex: 0, currentTrick: [], powerhouse: null, leaderIndex: 0 };
    }
    const room = rooms[roomId];
    if (!room.players.find(p => p.id === socket.id)) {
      room.players.push({ id: socket.id, name: name || socket.id });
      room.scores[socket.id] = 0;
    }
    socket.join(roomId);
    io.to(roomId).emit("room_update", { players: room.players, scores: room.scores });
    // start when >=4 players (minimum 4)
    if (room.players.length >= 4 && room.players.length <= 8) {
      // only start once: when first reaching >=4 and no hands exist
      if (Object.keys(room.hands || {}).length === 0) {
        startRound(roomId);
      } else {
        // if hands already dealt, just broadcast state
        io.to(roomId).emit("game_state", snapshot(roomId));
      }
    }
  });

  socket.on("select_powerhouse", ({ roomId, suit }) => {
    const room = rooms[roomId]; if (!room) return;
    // only leader can set
    const leader = room.players[room.leaderIndex];
    if (leader.id !== socket.id) return;
    room.powerhouse = suit || null;
    io.to(roomId).emit("powerhouse_set", { powerhouse: room.powerhouse });
    log("PowerHouse set to", room.powerhouse, "in", roomId);
  });

  socket.on("play_card", ({ roomId, card }) => {
    const room = rooms[roomId]; if (!room) return;
    const playerIndex = room.players.findIndex(p => p.id === socket.id);
    if (playerIndex === -1) return;

    // turn validation
    if (playerIndex !== room.turnIndex) {
      socket.emit("invalid_move", { reason: "not your turn" });
      return;
    }

    // validate card exists in player's hand
    const hand = room.hands[socket.id];
    if (!hand) { socket.emit("invalid_move", { reason: "no hand" }); return; }
    const cardIdx = hand.findIndex(c => c.suit === card.suit && c.rank === card.rank);
    if (cardIdx === -1) {
      socket.emit("invalid_move", { reason: "card not in hand" });
      return;
    }

    // follow-suit rule: if trick started and player has suit, must play same suit
    const trick = room.currentTrick;
    if (trick.length > 0) {
      const ledSuit = trick[0].card.suit;
      const hasLedSuit = hand.some(c => c.suit === ledSuit);
      if (hasLedSuit && card.suit !== ledSuit) {
        socket.emit("invalid_move", { reason: `must follow suit ${ledSuit}` });
        return;
      }
    }

    // remove from hand and add to trick
    hand.splice(cardIdx, 1);
    trick.push({ playerId: socket.id, card });

    io.to(roomId).emit("card_played", { playerId: socket.id, card, trickCount: trick.length });

    // advance turn
    room.turnIndex = (room.turnIndex + 1) % room.players.length;

    // if trick complete
    if (trick.length === room.players.length) {
      // determine winner
      const winnerIndex = determineTrickWinner(room, trick);
      const winnerPlayer = room.players[winnerIndex];
      // calculate trick points
      let trickPoints = 0;
      for (let p of trick) trickPoints += pointsOf(p.card);
      room.scores[winnerPlayer.id] += trickPoints;

      // add to room.log (optional)
      room.lastTrick = { winner: winnerPlayer.id, trick, trickPoints };

      io.to(roomId).emit("trick_complete", { winnerId: winnerPlayer.id, trick, trickPoints, scores: room.scores });

      // reset trick, set next turn to winner
      room.currentTrick = [];
      room.turnIndex = winnerIndex;

      // check end of round: hands empty?
      const anyCardsLeft = room.players.some(p => (room.hands[p.id] || []).length > 0);
      if (!anyCardsLeft) {
        // round over
        io.to(roomId).emit("round_over", { scores: room.scores });
        // prepare next round: reset hands and leader moves to next player
        room.leaderIndex = (room.leaderIndex + 1) % room.players.length;
        room.hands = {};
        // keep scores persistent; deal new round automatically
        startRound(roomId);
      } else {
        // send updated game_state
        io.to(roomId).emit("game_state", snapshot(roomId));
      }
    } else {
      // trick not complete, notify next turn
      io.to(roomId).emit("game_state", snapshot(roomId));
    }
  });

  socket.on("disconnect", () => {
    log("disconnect", socket.id);
    // remove from any rooms
    for (const roomId of Object.keys(rooms)) {
      const room = rooms[roomId];
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        room.players.splice(idx,1);
        delete room.scores[socket.id];
        delete room.hands[socket.id];
        io.to(roomId).emit("room_update", { players: room.players, scores: room.scores });
      }
      // if room empty delete
      if (room.players.length === 0) delete rooms[roomId];
    }
  });

}); // end connection

/* Helper: snapshot of state to send clients */
function snapshot(roomId) {
  const room = rooms[roomId];
  if (!room) return {};
  const handsCount = Object.fromEntries(room.players.map(p => [p.id, (room.hands[p.id]||[]).length]));
  return {
    players: room.players,
    scores: room.scores,
    handsCount,
    turnIndex: room.turnIndex,
    powerhouse: room.powerhouse,
    currentTrick: room.currentTrick
  };
}

/* Start a round: shuffle, reduce deck if needed, deal, set turn and notify clients */
function startRound(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  const playersCount = room.players.length;
  if (playersCount < 4) { io.to(roomId).emit("info", "Need at least 4 players to start"); return; }
  if (playersCount > 8) { io.to(roomId).emit("info", "Max 8 players allowed"); return; }

  let deck = generateDeck();
  // reduce deck by removing 2s first (then other low ranks) until divisible
  deck = reduceDeckToDivisible(deck, playersCount);
  deck = shuffle(deck);

  const perPlayer = Math.floor(deck.length / playersCount);
  room.hands = {};
  for (let i=0;i<playersCount;i++) {
    const player = room.players[i];
    room.hands[player.id] = deck.slice(i*perPlayer, (i+1)*perPlayer);
  }
  room.turnIndex = room.leaderIndex % playersCount;
  room.currentTrick = [];
  room.powerhouse = null; // leader must select
  io.to(roomId).emit("round_started", { handsCount: Object.fromEntries(room.players.map(p=>[p.id, room.hands[p.id].length])), leaderId: room.players[room.leaderIndex].id });
  // send full game state (clients reveal only their own hand)
  // but we need to send each player's own hand privately - we will emit separate events per player with their hand
  for (let p of room.players) {
    io.to(p.id).emit("deal_hand", { hand: room.hands[p.id], yourId: p.id, powerhouse: room.powerhouse });
  }
  io.to(roomId).emit("game_state", snapshot(roomId));
  log(`Round started in ${roomId} players=${playersCount}, perPlayer=${perPlayer}`);
}

/* Determine trick winner index (index into room.players) */
function determineTrickWinner(room, trick) {
  // trick: [{playerId, card}, ...] length = playersCount
  const powerhouse = room.powerhouse; // suit string or null
  // if any powerhouse played -> highest rank among powerhouse cards wins
  if (powerhouse) {
    const phPlays = trick.filter(t => t.card.suit === powerhouse);
    if (phPlays.length > 0) {
      // find max rank
      let winnerPid = phPlays[0].playerId;
      let maxVal = rankValue[phPlays[0].card.rank];
      for (let t of phPlays) {
        const v = rankValue[t.card.rank];
        if (v > maxVal) { maxVal = v; winnerPid = t.playerId; }
      }
      return room.players.findIndex(p => p.id === winnerPid);
    }
  }
  // otherwise, winner is highest of led suit
  const ledSuit = trick[0].card.suit;
  let winnerPid = trick[0].playerId;
  let maxVal = rankValue[trick[0].card.rank];
  for (let t of trick) {
    if (t.card.suit === ledSuit) {
      const v = rankValue[t.card.rank];
      if (v > maxVal) { maxVal = v; winnerPid = t.playerId; }
    }
  }
  return room.players.findIndex(p => p.id === winnerPid);
}

/* Start server */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening http://localhost:${PORT}`);
});
