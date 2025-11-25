// server/deck.js
const suits = ["spades", "hearts", "diamonds", "clubs"];
const ranks = ["A","K","Q","J","10","9","8","7","6","5","4","3","2"];

const pointValue = {
  "3-spades": 30,
  "A": 10, "K": 10, "Q": 10, "J": 10, "10": 10,
  "5": 5
};

function generateDeck() {
  const deck = [];
  for (let suit of suits) {
    for (let rank of ranks) {
      const id = `${rank}-${suit}`;
      const key = (rank === "3" && suit === "spades") ? "3-spades" : rank;
      deck.push({ id, suit, rank, points: pointValue[key] ?? 0 });
    }
  }
  return deck;
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

module.exports = { generateDeck, shuffle };
