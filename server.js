try { require("dotenv").config(); } catch (e) { /* dotenv optional */ }

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const webpush = require("web-push");
const { pickRandomDare, getSeverityLabel, getSeverityEmoji, DARE_POOLS, SEVERITY_WEIGHTS } = require("./dares");

// --------------- VAPID / Push setup ---------------
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_EMAIL = process.env.VAPID_EMAIL || "mailto:dryckeslek@example.com";

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Expose VAPID public key to clients
app.get("/api/push/vapid-key", (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC });
});

// Push subscription endpoint
app.post("/api/push/subscribe", (req, res) => {
  const { subscription, roomCode, playerId } = req.body;
  if (!subscription || !roomCode) return res.status(400).json({ error: "Missing data" });
  const room = rooms.get(roomCode);
  if (!room) return res.status(404).json({ error: "Room not found" });
  room.pushSubscriptions.set(playerId || "anon", subscription);
  res.json({ ok: true });
});

// --------------- Game config ---------------
const STARTING_BUDGET = 20;
const CREDITS_PER_ROUND = 3;
const BID_TIMER_SECONDS = 30;
const SUDDEN_DEATH_TIMER_SECONDS = 15;
const VOTE_TIMER_SECONDS = 20;
const REVEAL_PAUSE_SECONDS = 30;

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
    state: "lobby", // lobby | auction | resolving | reveal | countdown | waiting | voting
    mode: "pregame", // pregame | bar
    currentDare: null,
    bids: new Map(),
    bidTimer: null,
    roundNumber: 0,
    usedDareKeys: [],
    customDares: [],
    history: [],
    activeVote: null,
    // Auto-timer
    roundIntervalSec: 180, // default 3 min
    countdownTimer: null,
    revealTimer: null,
    readyPlayers: new Set(),
    // Push
    pushSubscriptions: new Map(),
    // Sudden death
    suddenDeathPlayers: null, // null or array of player ids
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
  const participants = room.suddenDeathPlayers
    ? new Set(room.suddenDeathPlayers)
    : null;
  for (const [id, p] of room.players) {
    if (p.connected) {
      if (participants && !participants.has(id)) continue;
      status[id] = room.bids.has(id);
    }
  }
  return status;
}

function clearRoomTimers(room) {
  if (room.bidTimer) { clearInterval(room.bidTimer); room.bidTimer = null; }
  if (room.countdownTimer) { clearInterval(room.countdownTimer); room.countdownTimer = null; }
  if (room.revealTimer) { clearTimeout(room.revealTimer); room.revealTimer = null; }
  if (room.activeVote?.timer) { clearInterval(room.activeVote.timer); }
}

// --------------- Push notifications ---------------
function sendPushToRoom(room, payload) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return;
  const body = JSON.stringify(payload);
  for (const [id, sub] of room.pushSubscriptions) {
    webpush.sendNotification(sub, body).catch(() => {
      room.pushSubscriptions.delete(id);
    });
  }
}

// --------------- Voting ---------------
function startVote(room, { type, dareText, proposedBy, returnToState }) {
  room.activeVote = {
    type,
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
    voteData.weights = SEVERITY_WEIGHTS;
  }

  io.to(room.code).emit("vote:start", voteData);

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

// --------------- Auto-timer / Countdown ---------------
function startRevealPause(room) {
  // After 30s reveal pause, start the countdown
  room.revealTimer = setTimeout(() => {
    room.revealTimer = null;
    startCountdown(room);
  }, REVEAL_PAUSE_SECONDS * 1000);

  // Tell clients the reveal pause has started
  io.to(room.code).emit("game:revealPause", { seconds: REVEAL_PAUSE_SECONDS });
}

function startCountdown(room) {
  room.state = "countdown";
  room.readyPlayers.clear();

  const total = room.roundIntervalSec;
  let remaining = total;

  io.to(room.code).emit("game:countdownStart", { total, remaining });

  room.countdownTimer = setInterval(() => {
    remaining--;
    io.to(room.code).emit("game:countdownTick", { total, remaining });

    if (remaining <= 0) {
      clearInterval(room.countdownTimer);
      room.countdownTimer = null;
      checkReadinessAndStart(room);
    }
  }, 1000);
}

function checkReadinessAndStart(room) {
  const connectedIds = getConnectedIds(room);
  const notReady = connectedIds.filter((id) => !room.readyPlayers.has(id));

  if (notReady.length === 0) {
    // All ready — start!
    sendPushToRoom(room, { title: "Dryckeslek", body: "Ny runda startar!" });
    startAuction(room);
  } else {
    // Some not ready — pause and wait
    room.state = "waiting";
    const missingNames = notReady.map((id) => room.players.get(id)?.name || "???");
    io.to(room.code).emit("game:waitingForPlayers", { missing: missingNames });
  }
}

// --------------- Auction ---------------
function startAuction(room) {
  room.roundNumber++;
  room.state = "auction";
  room.bids.clear();
  room.readyPlayers.clear();
  room.suddenDeathPlayers = null;

  if (room.roundNumber > 1) {
    for (const p of room.players.values()) {
      if (p.connected) p.budget += CREDITS_PER_ROUND;
    }
  }

  const dare = pickRandomDare(room.mode, room.usedDareKeys, room.customDares);
  room.usedDareKeys.push(dare.key);
  room.currentDare = dare;

  io.to(room.code).emit("auction:start", {
    roundNumber: room.roundNumber,
    mode: room.mode,
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

  room.state = "resolving";

  // Determine which players are participating in this round
  const isSuddenDeath = !!room.suddenDeathPlayers;
  const participantIds = isSuddenDeath
    ? room.suddenDeathPlayers.filter((id) => room.players.get(id)?.connected)
    : Array.from(room.players.entries()).filter(([, p]) => p.connected).map(([id]) => id);

  // Default bid 0 for anyone who didn't bid
  for (const id of participantIds) {
    if (!room.bids.has(id)) room.bids.set(id, 0);
  }

  // Find minimum bid among participants
  let minBid = Infinity;
  for (const id of participantIds) {
    const amount = room.bids.get(id) ?? 0;
    if (amount < minBid) minBid = amount;
  }

  const losers = [];
  for (const id of participantIds) {
    if ((room.bids.get(id) ?? 0) === minBid) losers.push(id);
  }

  const isTie = losers.length > 1;

  // Deduct bids from participants
  for (const id of participantIds) {
    const player = room.players.get(id);
    if (player) {
      const amount = room.bids.get(id) ?? 0;
      player.budget -= amount;
      if (player.budget < 0) player.budget = 0;
    }
  }

  // Build bids list for display
  const allBids = [];
  for (const id of participantIds) {
    const player = room.players.get(id);
    if (player) {
      allBids.push({ id, name: player.name, bid: room.bids.get(id) ?? 0, isLoser: losers.includes(id) });
    }
  }
  allBids.sort((a, b) => b.bid - a.bid);

  const connectedPlayers = Array.from(room.players.entries()).filter(([, p]) => p.connected);
  const playerNames = connectedPlayers.map(([id, p]) => ({ id, name: p.name }));
  const tiedNames = losers.map((id) => room.players.get(id)?.name || "???");

  const darePayload = {
    text: room.currentDare.text,
    severity: room.currentDare.severity,
    severityLabel: getSeverityLabel(room.currentDare.severity),
    severityEmoji: getSeverityEmoji(room.currentDare.severity),
  };

  // Emit roulette animation
  io.to(room.code).emit("auction:resolving", {
    playerNames,
    dare: darePayload,
    isTie,
    tiedNames,
  });

  if (isTie) {
    // After roulette animation, start sudden death
    setTimeout(() => {
      startSuddenDeath(room, losers, allBids);
    }, 9500);
  } else {
    // Single loser — normal reveal
    const loserId = losers[0];
    const loserName = room.players.get(loserId)?.name || "???";

    room.history.push({
      dare: room.currentDare.text,
      loserId, loserName,
      bid: minBid,
      round: room.roundNumber,
    });

    room.suddenDeathPlayers = null;

    setTimeout(() => {
      room.state = "reveal";
      io.to(room.code).emit("auction:reveal", {
        dare: darePayload,
        bids: allBids,
        loserId,
        loserName,
        players: getPlayersArray(room),
      });

      startRevealPause(room);
    }, 9500);
  }
}

function startSuddenDeath(room, tiedPlayerIds, previousBids) {
  room.suddenDeathPlayers = tiedPlayerIds;
  room.state = "auction";
  room.bids.clear();

  const tiedNames = tiedPlayerIds.map((id) => room.players.get(id)?.name || "???");

  io.to(room.code).emit("auction:suddenDeath", {
    tiedPlayers: tiedPlayerIds,
    tiedNames,
    previousBids,
    dare: {
      text: room.currentDare.text,
      severity: room.currentDare.severity,
      severityLabel: getSeverityLabel(room.currentDare.severity),
      severityEmoji: getSeverityEmoji(room.currentDare.severity),
    },
    players: getPlayersArray(room),
    timerSeconds: SUDDEN_DEATH_TIMER_SECONDS,
    roundNumber: room.roundNumber,
    mode: room.mode,
  });

  let remaining = SUDDEN_DEATH_TIMER_SECONDS;
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

// --------------- Socket.IO ---------------
io.on("connection", (socket) => {
  console.log(`Connected: ${socket.id}`);

  socket.on("room:create", ({ playerName }, callback) => {
    const room = createRoom(socket.id, playerName);
    socket.join(room.code);
    callback({ ok: true, roomCode: room.code, players: getPlayersArray(room), mode: room.mode, roundIntervalSec: room.roundIntervalSec });
  });

  socket.on("room:join", ({ roomCode, playerName }, callback) => {
    const code = roomCode.toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return callback({ ok: false, error: "Rummet finns inte" });

    // Check if a disconnected player with the same name exists — reconnect them
    let reconnectedOldId = null;
    for (const [oldId, p] of room.players) {
      if (p.name.toLowerCase() === playerName.toLowerCase()) {
        if (!p.connected) {
          // Reconnect: move player data from old ID to new socket ID
          reconnectedOldId = oldId;
          room.players.delete(oldId);
          p.connected = true;
          room.players.set(socket.id, p);
          // Transfer host if the old ID was host
          if (room.hostId === oldId) room.hostId = socket.id;
          // Transfer ready status
          if (room.readyPlayers.has(oldId)) {
            room.readyPlayers.delete(oldId);
            room.readyPlayers.add(socket.id);
          }
          // Transfer sudden death participation
          if (room.suddenDeathPlayers) {
            const idx = room.suddenDeathPlayers.indexOf(oldId);
            if (idx !== -1) room.suddenDeathPlayers[idx] = socket.id;
          }
          break;
        } else {
          return callback({ ok: false, error: "Namnet är redan taget" });
        }
      }
    }

    if (!reconnectedOldId) {
      // New player — calculate budget
      let budget = STARTING_BUDGET;
      if (room.state !== "lobby") {
        const connectedBudgets = Array.from(room.players.values())
          .filter((p) => p.connected)
          .map((p) => p.budget);
        if (connectedBudgets.length > 0) {
          budget = Math.round(connectedBudgets.reduce((a, b) => a + b, 0) / connectedBudgets.length);
        }
      }
      room.players.set(socket.id, { name: playerName, budget, connected: true });
    }

    socket.join(code);

    const players = getPlayersArray(room);
    const joinedMidGame = room.state !== "lobby";
    const isReconnect = !!reconnectedOldId;
    callback({ ok: true, roomCode: code, players, customDares: room.customDares, mode: room.mode, roundIntervalSec: room.roundIntervalSec, joinedMidGame, gameState: room.state, isReconnect });
    socket.to(code).emit("room:playerJoined", { players });

    // If reconnecting during waiting state, check if all are now ready
    if (isReconnect && room.state === "waiting") {
      room.readyPlayers.add(socket.id);
      const connectedIds = getConnectedIds(room);
      if (connectedIds.every((id) => room.readyPlayers.has(id))) {
        startAuction(room);
      } else {
        const missingNames = connectedIds
          .filter((id) => !room.readyPlayers.has(id))
          .map((id) => room.players.get(id)?.name || "???");
        io.to(room.code).emit("game:waitingForPlayers", { missing: missingNames });
      }
    }
  });

  // --- Set round interval ---
  socket.on("game:setInterval", ({ seconds }, callback) => {
    const room = getRoomByPlayer(socket.id);
    if (!room) return callback?.({ ok: false });
    if (room.hostId !== socket.id) return callback?.({ ok: false });
    if (room.state !== "lobby") return callback?.({ ok: false });
    const sec = Math.max(10, Math.min(3600, Math.floor(seconds)));
    room.roundIntervalSec = sec;
    io.to(room.code).emit("game:intervalChanged", { seconds: sec });
    callback?.({ ok: true, seconds: sec });
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

    const voteStatus = {};
    for (const [id, p] of room.players) {
      if (p.connected) voteStatus[id] = room.activeVote.votes.has(id);
    }
    io.to(room.code).emit("vote:update", { voteStatus });

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

    // In sudden death, only participants can bid
    if (room.suddenDeathPlayers && !room.suddenDeathPlayers.includes(socket.id)) {
      return callback?.({ ok: false, error: "Du är inte med i sudden death" });
    }

    const player = room.players.get(socket.id);
    const bid = Math.max(0, Math.min(Math.floor(amount), player.budget));
    room.bids.set(socket.id, bid);
    callback?.({ ok: true, bid });
    io.to(room.code).emit("auction:bidsUpdate", { bidsStatus: getBidsStatus(room) });

    // Check if all participants have bid
    const expectedCount = room.suddenDeathPlayers
      ? room.suddenDeathPlayers.filter((id) => room.players.get(id)?.connected).length
      : getConnectedIds(room).length;
    if (room.bids.size >= expectedCount) resolveAuction(room);
  });

  // --- Player ready (during countdown) ---
  socket.on("game:ready", (_, callback) => {
    const room = getRoomByPlayer(socket.id);
    if (!room) return callback?.({ ok: false });
    room.readyPlayers.add(socket.id);
    callback?.({ ok: true });

    // If we're in waiting state and now everyone is ready, start
    if (room.state === "waiting") {
      const connectedIds = getConnectedIds(room);
      const allReady = connectedIds.every((id) => room.readyPlayers.has(id));
      if (allReady) {
        sendPushToRoom(room, { title: "Dryckeslek", body: "Ny runda startar!" });
        startAuction(room);
      }
    }
  });

  // --- Force start (host skips waiting) ---
  socket.on("game:forceStart", (_, callback) => {
    const room = getRoomByPlayer(socket.id);
    if (!room) return callback?.({ ok: false });
    if (room.hostId !== socket.id) return callback?.({ ok: false, error: "Bara värden" });
    if (room.state !== "waiting") return callback?.({ ok: false });
    sendPushToRoom(room, { title: "Dryckeslek", body: "Ny runda startar!" });
    startAuction(room);
    callback?.({ ok: true });
  });

  // --- End game ---
  socket.on("game:end", (_, callback) => {
    const room = getRoomByPlayer(socket.id);
    if (!room) return callback?.({ ok: false });
    if (room.hostId !== socket.id) return callback?.({ ok: false, error: "Bara värden" });
    clearRoomTimers(room);
    room.state = "lobby";
    room.roundNumber = 0;
    room.usedDareKeys = [];
    room.history = [];
    room.readyPlayers.clear();
    // Reset budgets
    for (const p of room.players.values()) {
      p.budget = STARTING_BUDGET;
    }
    io.to(room.code).emit("game:ended", { players: getPlayersArray(room) });
    callback?.({ ok: true });
  });

  socket.on("game:switchMode", (_, callback) => {
    const room = getRoomByPlayer(socket.id);
    if (!room) return callback?.({ ok: false });
    if (room.hostId !== socket.id) return callback?.({ ok: false, error: "Bara värden kan byta läge" });
    if (!["lobby", "reveal", "countdown", "waiting"].includes(room.state)) return callback?.({ ok: false, error: "Kan inte byta läge just nu" });

    room.mode = room.mode === "pregame" ? "bar" : "pregame";
    room.usedDareKeys = [];
    io.to(room.code).emit("game:modeChanged", { mode: room.mode });
    callback?.({ ok: true, mode: room.mode });
  });

  // --- Leave room voluntarily ---
  socket.on("room:leave", (_, callback) => {
    const room = getRoomByPlayer(socket.id);
    if (!room) return callback?.({ ok: false });
    const player = room.players.get(socket.id);
    const playerName = player?.name || "???";

    socket.leave(room.code);
    room.players.delete(socket.id);
    room.readyPlayers.delete(socket.id);

    // Transfer host if needed
    if (room.hostId === socket.id) {
      for (const [id, p] of room.players) {
        if (p.connected) {
          room.hostId = id;
          io.to(room.code).emit("room:hostChanged", { newHostId: id, newHostName: p.name });
          break;
        }
      }
    }

    io.to(room.code).emit("room:playerLeft", {
      playerId: socket.id, playerName,
      players: getPlayersArray(room),
    });

    // Clean up empty rooms
    const anyConnected = Array.from(room.players.values()).some((p) => p.connected);
    if (!anyConnected || room.players.size === 0) {
      clearRoomTimers(room);
      rooms.delete(room.code);
    }

    // If in auction and all remaining have bid, resolve
    if (room.state === "auction" && room.players.size > 0) {
      const connectedCount = getConnectedIds(room).length;
      if (connectedCount > 0 && room.bids.size >= connectedCount) {
        resolveAuction(room);
      }
    }

    // If waiting and now all ready, start
    if (room.state === "waiting" && room.players.size > 0) {
      const connectedIds = getConnectedIds(room);
      if (connectedIds.length > 0 && connectedIds.every((id) => room.readyPlayers.has(id))) {
        startAuction(room);
      }
    }

    callback?.({ ok: true });
  });

  socket.on("disconnect", () => {
    const room = getRoomByPlayer(socket.id);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player) return;

    player.connected = false;
    room.readyPlayers.delete(socket.id);

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

    if (room.activeVote) {
      const connectedCount = getConnectedIds(room).length;
      if (connectedCount > 0 && room.activeVote.votes.size >= connectedCount) {
        resolveVote(room);
      }
    }

    if (room.state === "auction") {
      const connectedCount = getConnectedIds(room).length;
      if (connectedCount === 0) {
        clearRoomTimers(room);
        rooms.delete(room.code);
      } else if (room.bids.size >= connectedCount) {
        resolveAuction(room);
      }
    }

    // If waiting and now everyone remaining is ready, start
    if (room.state === "waiting") {
      const connectedIds = getConnectedIds(room);
      if (connectedIds.length > 0 && connectedIds.every((id) => room.readyPlayers.has(id))) {
        startAuction(room);
      }
    }

    const anyConnected = Array.from(room.players.values()).some((p) => p.connected);
    if (!anyConnected) {
      clearRoomTimers(room);
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
