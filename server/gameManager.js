// server/gameManager.js
const { generateDeck, shuffle } = require("./deck");

const rooms = {};         // { roomId: { players: [], hands: {} } }
const playerToRoom = {};  // playerId -> roomId

function addPlayerToRoom(roomId, playerId) {
  if (!rooms[roomId]) rooms[roomId] = { players: [], hands: {} };
  if (!rooms[roomId].players.includes(playerId)) {
    rooms[roomId].players.push(playerId);
    playerToRoom[playerId] = roomId;
  }
  return rooms[roomId].players;
}

function dealCards(roomId) {
  const room = rooms[roomId];
  if (!room) return {};
  let deck = shuffle(generateDeck());
  const hands = {};
  room.players.forEach((playerId, index) => {
    hands[playerId] = deck.slice(index * 13, (index + 1) * 13);
  });
  room.hands = hands;
  return hands;
}

function removePlayer(playerId) {
  const roomId = playerToRoom[playerId];
  if (!roomId || !rooms[roomId]) return;
  rooms[roomId].players = rooms[roomId].players.filter(p => p !== playerId);
  delete playerToRoom[playerId];
  if (rooms[roomId].players.length === 0) delete rooms[roomId];
}

module.exports = { addPlayerToRoom, dealCards, removePlayer };
