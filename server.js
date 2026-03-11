const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const { pickRandomDare, getSeverityLabel, getSeverityEmoji } = require("./dares");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

// --------------- Game config ---------------
const STARTING_BUDGET = 20;
const CREDITS_PER_ROUND = 3;
const BID_TIMER_SECONDS = 30;
const VOTE_TIMER_SECONDS = 20;

// --------------- State ---------------
const rooms = new Map();

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? generateRoomCode() : code;
}

function createRoom(hostId, hostName) {
  const code = generateRoomCode();
  const room = {
    code,
    hostId,
    players: new Map(),
    state: "lobby", // lobby | auction | reveal | voting
    currentDare: null,
    bids: new Map(),
    bidTimer: null,
    roundNumber: 0,
    usedDareKeys: [],
    customDares: [],
    history: [],
    activeVote: null,
  };
  room.players.set(hostId, { name: hostName, budget: STARTING_BUDGET, connected: true });
  rooms.set(code, room);
  return room;
}

function getRoomByPlayer(socketId) {
  for (const room of rooms.values()) {
    if (room.players.has(socketId)) return room;
  }
  return null;
}

function getPlayersArray(room) {
  return Array.from(room.players.entries()).map(([id, p]) => ({
    id, name: p.name, budget: p.budget, connected: p.connected,
  }));
}

function getConnectedIds(room) {
  return Array.from(room.players.entries())
    .filter(([, p]) => p.connected)
    .map(([id]) => id);
}

function getBidsStatus(room) {
  const status = {};
  for (const [id, p] of room.players) {
    if (p.connected) status[id] = room.bids.has(id);
  }
  return status;
}

// --------------- Voting ---------------
function startVote(room, { type, dareText, proposedBy, returnToState }) {
  const connectedIds = getConnectedIds(room);
  room.activeVote = {
    type, // 'approve' | 'severity'
    dareText,
    proposedBy,
    votes: new Map(),
    returnToState: returnToState || room.state,
  };
  room.state = "voting";

  const voteData = {
    type,
    dareText,
    proposedBy,
    timerSeconds: VOTE_TIMER_SECONDS,
  };

  if (type === "severity") {
    voteData.options = [1, 2, 3, 4, 5];
  }

  io.to(room.code).emit("vote:start", voteData);

  // Timer
  let remaining = VOTE_TIMER_SECONDS;
  room.activeVote.timer = setInterval(() => {
    remaining--;
    io.to(room.code).emit("vote:tick", { remaining });
    if (remaining <= 0) {
      resolveVote(room);
    }
  }, 1000);
}

function resolveVote(room) {
  const vote = room.activeVote;
  if (!vote) return;

  if (vote.timer) {
    clearInterval(vote.timer);
    vote.timer = null;
  }

  const connectedIds = getConnectedIds(room);

  if (vote.type === "approve") {
    // Count yes votes. Non-voters count as "no"
    let yesCount = 0;
    let totalVoters = connectedIds.length;
    for (const [id, val] of vote.votes) {
      if (val === true && room.players.get(id)?.connected) yesCount++;
    }
    const approved = yesCount > totalVoters / 2;

    io.to(room.code).emit("vote:result", {
      type: "approve",
      approved,
      yesCount,
      totalVoters,
      dareText: vote.dareText,
    });

    if (approved) {
      // Start severity vote after short delay
      const dareText = vote.dareText;
      const proposedBy = vote.proposedBy;
      const returnTo = vote.returnToState;
      room.activeVote = null;

      setTimeout(() => {
        startVote(room, {
          type: "severity",
          dareText,
          proposedBy,
          returnToState: returnTo,
        });
      }, 2000);
    } else {
      const returnTo = vote.returnToState;
      room.activeVote = null;
      setTimeout(() => {
        room.state = returnTo;
        io.to(room.code).emit("vote:done", { state: returnTo });
      }, 2000);
    }
  } else if (vote.type === "severity") {
    // Tally severity votes — most voted wins, ties go to higher severity
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const [id, val] of vote.votes) {
      if (room.players.get(id)?.connected && val >= 1 && val <= 5) {
        counts[val]++;
      }
    }

    let winningSeverity = 3;
    let maxCount = 0;
    for (let s = 5; s >= 1; s--) {
      if (counts[s] > maxCount) {
        maxCount = counts[s];
        winningSeverity = s;
      }
    }

    // Add the dare
    room.customDares.push({
      text: vote.dareText,
      severity: winningSeverity,
      addedBy: vote.proposedBy,
    });

    io.to(room.code).emit("vote:result", {
      type: "severity",
      severity: winningSeverity,
      severityLabel: getSeverityLabel(winningSeverity),
      severityEmoji: getSeverityEmoji(winningSeverity),
      dareText: vote.dareText,
      counts,
    });

    io.to(room.code).emit("dare:updated", { customDares: room.customDares });

    const returnTo = vote.returnToState;
    room.activeVote = null;
    setTimeout(() => {
      room.state = returnTo;
      io.to(room.code).emit("vote:done", { state: returnTo });
    }, 3000);
  }
}

// --------------- Auction ---------------
function startAuction(room) {
  room.roundNumber++;
  room.state = "auction";
  room.bids.clear();

  if (room.roundNumber > 1) {
    for (const p of room.players.values()) {
      if (p.connected) p.budget += CREDITS_PER_ROUND;
    }
  }

  const dare = pickRandomDare(room.usedDareKeys, room.customDares);
  room.usedDareKeys.push(dare.key);
  room.currentDare = dare;

  io.to(room.code).emit("auction:start", {
    roundNumber: room.roundNumber,
    dare: {
      text: dare.text,
      severity: dare.severity,
      severityLabel: getSeverityLabel(dare.severity),
      severityEmoji: getSeverityEmoji(dare.severity),
    },
    players: getPlayersArray(room),
    timerSeconds: BID_TIMER_SECONDS,
  });

  let remaining = BID_TIMER_SECONDS;
  room.bidTimer = setInterval(() => {
    remaining--;
    io.to(room.code).emit("auction:tick", { remaining });
    if (remaining <= 0) {
      clearInterval(room.bidTimer);
      room.bidTimer = null;
      resolveAuction(room);
    }
  }, 1000);
}

function resolveAuction(room) {
  if (room.bidTimer) {
    clearInterval(room.bidTimer);
    room.bidTimer = null;
  }

  // Don't go to reveal yet — send "resolving" for animation
  room.state = "resolving";

  const connectedPlayers = Array.from(room.players.entries()).filter(([, p]) => p.connected);
  for (const [id] of connectedPlayers) {
    if (!room.bids.has(id)) room.bids.set(id, 0);
  }

  let minBid = Infinity;
  for (const [id, amount] of room.bids) {
    if (room.players.get(id)?.connected && amount < minBid) minBid = amount;
  }

  const losers = [];
  for (const [id, amount] of room.bids) {
    if (room.players.get(id)?.connected && amount === minBid) losers.push(id);
  }

  const loserId = losers[Math.floor(Math.random() * losers.length)];
  const loserName = room.players.get(loserId)?.name || "???";

  for (const [id, amount] of room.bids) {
    const player = room.players.get(id);
    if (player) {
      player.budget -= amount;
      if (player.budget < 0) player.budget = 0;
    }
  }

  const allBids = [];
  for (const [id, amount] of room.bids) {
    const player = room.players.get(id);
    if (player) {
      allBids.push({ id, name: player.name, bid: amount, isLoser: id === loserId });
    }
  }
  allBids.sort((a, b) => b.bid - a.bid);

  room.history.push({
    dare: room.currentDare.text,
    loserId, loserName,
    bid: minBid,
    round: room.roundNumber,
  });

  // Send player names for the roulette animation, then the actual result after delay
  const playerNames = connectedPlayers.map(([id, p]) => ({ id, name: p.name }));

  io.to(room.code).emit("auction:resolving", {
    playerNames,
    dare: {
      text: room.currentDare.text,
      severity: room.currentDare.severity,
      severityLabel: getSeverityLabel(room.currentDare.severity),
      severityEmoji: getSeverityEmoji(room.currentDare.severity),
    },
  });

  // After roulette animation finishes (~7s spin + possible bounce)
  setTimeout(() => {
    room.state = "reveal";
    io.to(room.code).emit("auction:reveal", {
      dare: {
        text: room.currentDare.text,
        severity: room.currentDare.severity,
        severityLabel: getSeverityLabel(room.currentDare.severity),
        severityEmoji: getSeverityEmoji(room.currentDare.severity),
      },
      bids: allBids,
      loserId,
      loserName,
      players: getPlayersArray(room),
    });
  }, 9500);
}

// --------------- Socket.IO ---------------
io.on("connection", (socket) => {
  console.log(`Connected: ${socket.id}`);

  socket.on("room:create", ({ playerName }, callback) => {
    const room = createRoom(socket.id, playerName);
    socket.join(room.code);
    callback({ ok: true, roomCode: room.code, players: getPlayersArray(room) });
  });

  socket.on("room:join", ({ roomCode, playerName }, callback) => {
    const code = roomCode.toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return callback({ ok: false, error: "Rummet finns inte" });
    if (room.state !== "lobby") return callback({ ok: false, error: "Spelet har redan startat" });

    for (const p of room.players.values()) {
      if (p.name.toLowerCase() === playerName.toLowerCase()) {
        return callback({ ok: false, error: "Namnet är redan taget" });
      }
    }

    room.players.set(socket.id, { name: playerName, budget: STARTING_BUDGET, connected: true });
    socket.join(code);

    const players = getPlayersArray(room);
    callback({ ok: true, roomCode: code, players, customDares: room.customDares });
    socket.to(code).emit("room:playerJoined", { players });
  });

  // --- Dare proposal (lobby or during game) ---
  socket.on("dare:propose", ({ text }, callback) => {
    const room = getRoomByPlayer(socket.id);
    if (!room) return callback?.({ ok: false, error: "Inget rum" });
    if (room.activeVote) return callback?.({ ok: false, error: "En omröstning pågår redan" });
    if (!["lobby", "reveal"].includes(room.state)) {
      return callback?.({ ok: false, error: "Kan inte föreslå just nu" });
    }

    const trimmed = (text || "").trim();
    if (!trimmed || trimmed.length > 120) return callback?.({ ok: false, error: "Ogiltig text" });

    const player = room.players.get(socket.id);
    callback?.({ ok: true });

    startVote(room, {
      type: "approve",
      dareText: trimmed,
      proposedBy: player.name,
      returnToState: room.state,
    });
  });

  // --- Vote casting ---
  socket.on("vote:cast", ({ value }, callback) => {
    const room = getRoomByPlayer(socket.id);
    if (!room || !room.activeVote) return callback?.({ ok: false });

    room.activeVote.votes.set(socket.id, value);
    callback?.({ ok: true });

    // Broadcast who has voted
    const voteStatus = {};
    for (const [id, p] of room.players) {
      if (p.connected) voteStatus[id] = room.activeVote.votes.has(id);
    }
    io.to(room.code).emit("vote:update", { voteStatus });

    // If all connected have voted, resolve
    const connectedCount = getConnectedIds(room).length;
    if (room.activeVote.votes.size >= connectedCount) {
      resolveVote(room);
    }
  });

  // --- Dare removal (lobby only) ---
  socket.on("dare:remove", ({ index }, callback) => {
    const room = getRoomByPlayer(socket.id);
    if (!room || room.state !== "lobby") return callback?.({ ok: false });
    if (index < 0 || index >= room.customDares.length) return callback?.({ ok: false });
    room.customDares.splice(index, 1);
    callback?.({ ok: true });
    io.to(room.code).emit("dare:updated", { customDares: room.customDares });
  });

  socket.on("game:start", (_, callback) => {
    const room = getRoomByPlayer(socket.id);
    if (!room) return callback?.({ ok: false, error: "Inget rum" });
    if (room.hostId !== socket.id) return callback?.({ ok: false, error: "Bara värden kan starta" });
    if (room.players.size < 2) return callback?.({ ok: false, error: "Minst 2 spelare krävs" });
    startAuction(room);
    callback?.({ ok: true });
  });

  socket.on("auction:bid", ({ amount }, callback) => {
    const room = getRoomByPlayer(socket.id);
    if (!room || room.state !== "auction") return callback?.({ ok: false, error: "Ingen aktiv auktion" });
    const player = room.players.get(socket.id);
    const bid = Math.max(0, Math.min(Math.floor(amount), player.budget));
    room.bids.set(socket.id, bid);
    callback?.({ ok: true, bid });
    io.to(room.code).emit("auction:bidsUpdate", { bidsStatus: getBidsStatus(room) });

    const connectedCount = getConnectedIds(room).length;
    if (room.bids.size >= connectedCount) resolveAuction(room);
  });

  socket.on("game:nextRound", (_, callback) => {
    const room = getRoomByPlayer(socket.id);
    if (!room) return callback?.({ ok: false });
    if (room.hostId !== socket.id) return callback?.({ ok: false, error: "Bara värden kan gå vidare" });
    if (room.state !== "reveal") return callback?.({ ok: false });
    startAuction(room);
    callback?.({ ok: true });
  });

  socket.on("disconnect", () => {
    const room = getRoomByPlayer(socket.id);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player) return;

    player.connected = false;

    if (room.hostId === socket.id) {
      for (const [id, p] of room.players) {
        if (p.connected && id !== socket.id) {
          room.hostId = id;
          io.to(room.code).emit("room:hostChanged", { newHostId: id, newHostName: p.name });
          break;
        }
      }
    }

    io.to(room.code).emit("room:playerLeft", {
      playerId: socket.id, playerName: player.name,
      players: getPlayersArray(room),
    });

    // Check if vote should resolve
    if (room.activeVote) {
      const connectedCount = getConnectedIds(room).length;
      if (connectedCount > 0 && room.activeVote.votes.size >= connectedCount) {
        resolveVote(room);
      }
    }

    if (room.state === "auction") {
      const connectedCount = getConnectedIds(room).length;
      if (connectedCount === 0) {
        if (room.bidTimer) clearInterval(room.bidTimer);
        rooms.delete(room.code);
      } else if (room.bids.size >= connectedCount) {
        resolveAuction(room);
      }
    }

    const anyConnected = Array.from(room.players.values()).some((p) => p.connected);
    if (!anyConnected) {
      if (room.bidTimer) clearInterval(room.bidTimer);
      if (room.activeVote?.timer) clearInterval(room.activeVote.timer);
      rooms.delete(room.code);
    }
  });
});

// --------------- Start ---------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
  const os = require("os");
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) {
        console.log(`  -> Phones: http://${net.address}:${PORT}`);
      }
    }
  }
});
