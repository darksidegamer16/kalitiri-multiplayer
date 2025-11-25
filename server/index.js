// server/index.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const gameManager = require("./gameManager");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  socket.on("joinRoom", (roomId) => {
    socket.join(roomId);
    const players = gameManager.addPlayerToRoom(roomId, socket.id);
    io.to(roomId).emit("playersUpdate", players);

    if (players.length === 4) {
      const hands = gameManager.dealCards(roomId);
      io.to(roomId).emit("cardsDealt", hands);
    }
  });

  socket.on("playCard", (data) => {
    io.to(data.roomId).emit("cardPlayed", data);
  });

  socket.on("disconnect", () => {
    console.log("Player disconnected:", socket.id);
    gameManager.removePlayer(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
