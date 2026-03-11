const socket = io();

// --- State ---
let myId = null;
let roomCode = null;
let isHost = false;
let myBudget = 0;
let currentBid = 0;
let maxBid = 0;
let timerTotal = 30;
let hasBid = false;
let customDares = [];
let hasVoted = false;
let voteTimerTotal = 20;

// --- DOM helpers ---
const $ = (sel) => document.querySelector(sel);
const screens = document.querySelectorAll(".screen");

function showScreen(id) {
  screens.forEach((s) => s.classList.remove("active"));
  $(`#screen-${id}`).classList.add("active");
}

function showToast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function vibrate(ms = 50) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

function esc(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

// ======================== URL PARAMS ========================
(function handleRoomParam() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("room");
  if (code) {
    $("#input-code").value = code.toUpperCase();
    // Clean the URL without reloading
    window.history.replaceState({}, "", window.location.pathname);
  }
})();

// ======================== HOME ========================
$("#btn-create").addEventListener("click", () => {
  const name = $("#input-name").value.trim();
  if (!name) return ($("#home-error").textContent = "Skriv ditt namn!");
  $("#home-error").textContent = "";
  socket.emit("room:create", { playerName: name }, (res) => {
    if (res.ok) {
      myId = socket.id;
      roomCode = res.roomCode;
      isHost = true;
      renderLobby(res.players);
      showScreen("lobby");
    }
  });
});

$("#btn-join").addEventListener("click", () => {
  const name = $("#input-name").value.trim();
  const code = $("#input-code").value.trim();
  if (!name) return ($("#home-error").textContent = "Skriv ditt namn!");
  if (!code || code.length < 4) return ($("#home-error").textContent = "Ange rumskod!");
  $("#home-error").textContent = "";
  socket.emit("room:join", { roomCode: code, playerName: name }, (res) => {
    if (res.ok) {
      myId = socket.id;
      roomCode = res.roomCode;
      isHost = false;
      customDares = res.customDares || [];
      renderLobby(res.players);
      renderCustomDares();
      showScreen("lobby");
    } else {
      $("#home-error").textContent = res.error;
    }
  });
});

$("#input-name").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    if ($("#input-code").value.trim()) $("#btn-join").click();
    else $("#input-code").focus();
  }
});
$("#input-code").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#btn-join").click();
});

// ======================== LOBBY ========================
function renderLobby(players) {
  $("#lobby-code").textContent = roomCode;

  // Share link
  const shareUrl = `${window.location.origin}?room=${roomCode}`;
  $("#share-link-text").textContent = shareUrl;

  const list = $("#lobby-players");
  list.innerHTML = "";
  players.forEach((p) => {
    const div = document.createElement("div");
    div.className = "player-item";
    const isHostPlayer = p.id === players[0]?.id;
    div.innerHTML = `
      <span class="player-name">${esc(p.name)}</span>
      ${isHostPlayer ? '<span class="player-badge">Värd</span>' : ""}
    `;
    list.appendChild(div);
  });

  if (isHost) {
    $("#lobby-host-controls").classList.remove("hidden");
    $("#lobby-waiting").classList.add("hidden");
  } else {
    $("#lobby-host-controls").classList.add("hidden");
    $("#lobby-waiting").classList.remove("hidden");
  }
}

function renderCustomDares() {
  const list = $("#custom-dares-list");
  list.innerHTML = "";
  const emojis = { 1: "😊", 2: "😅", 3: "😬", 4: "🔥", 5: "💀" };
  customDares.forEach((d, i) => {
    const item = document.createElement("div");
    item.className = "dare-list-item";
    item.innerHTML = `
      <div class="dare-list-info">
        <div class="dare-list-text">${emojis[d.severity] || ""} ${esc(d.text)}</div>
        <div class="dare-list-meta">av ${esc(d.addedBy)}</div>
      </div>
      <button class="dare-remove" data-index="${i}">✕</button>
    `;
    list.appendChild(item);
  });
  list.querySelectorAll(".dare-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      socket.emit("dare:remove", { index: parseInt(btn.dataset.index, 10) });
    });
  });
}

// Copy share link
$("#btn-copy-link").addEventListener("click", () => {
  const url = $("#share-link-text").textContent;
  navigator.clipboard.writeText(url).then(() => {
    const btn = $("#btn-copy-link");
    btn.textContent = "Kopierad!";
    btn.classList.add("copied");
    setTimeout(() => {
      btn.textContent = "Kopiera";
      btn.classList.remove("copied");
    }, 2000);
    vibrate(30);
  });
});

// Propose dare (lobby)
$("#btn-propose-dare").addEventListener("click", () => {
  const text = $("#input-dare-text").value.trim();
  if (!text) return;
  socket.emit("dare:propose", { text }, (res) => {
    if (res.ok) {
      $("#input-dare-text").value = "";
    } else {
      showToast(res.error || "Kunde inte föreslå");
    }
  });
});

$("#input-dare-text").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#btn-propose-dare").click();
});

// Propose dare (in-game)
$("#btn-propose-ingame").addEventListener("click", () => {
  const text = prompt("Skriv din dare:");
  if (!text || !text.trim()) return;
  socket.emit("dare:propose", { text: text.trim() }, (res) => {
    if (!res.ok) showToast(res.error || "Kunde inte föreslå");
  });
});

socket.on("dare:updated", ({ customDares: dares }) => {
  customDares = dares;
  renderCustomDares();
});

// Start game
$("#btn-start").addEventListener("click", () => {
  socket.emit("game:start", null, (res) => {
    if (!res.ok) $("#lobby-error").textContent = res.error;
  });
});

socket.on("room:playerJoined", ({ players }) => {
  renderLobby(players);
  vibrate();
  showToast("Ny spelare!");
});

socket.on("room:playerLeft", ({ playerName, players }) => {
  const active = document.querySelector(".screen.active")?.id;
  if (active === "screen-lobby") renderLobby(players);
  showToast(`${playerName} lämnade`);
});

socket.on("room:hostChanged", ({ newHostId, newHostName }) => {
  isHost = newHostId === socket.id;
  showToast(`${newHostName} är ny värd`);
});

// ======================== AUCTION ========================
socket.on("auction:start", (data) => {
  hasBid = false;
  currentBid = 0;

  const me = data.players.find((p) => p.id === socket.id);
  myBudget = me ? me.budget : 0;
  maxBid = myBudget;

  $("#auction-round").textContent = data.roundNumber;
  $("#auction-budget").textContent = myBudget;
  $("#dare-text").textContent = data.dare.text;
  $("#dare-severity").textContent = `${data.dare.severityEmoji} ${data.dare.severityLabel}`;
  $("#dare-card").className = `dare-card${data.dare.severity === 5 ? " sev-5" : ""}`;

  timerTotal = data.timerSeconds;
  $("#timer-seconds").textContent = timerTotal;
  $("#timer-bar").style.width = "100%";

  updateBidDisplay();
  $("#bid-slider").max = maxBid;
  $("#bid-slider").value = 0;
  $("#bid-section").classList.remove("hidden");
  $("#bid-placed").classList.add("hidden");
  $("#bids-status").innerHTML = "";

  showScreen("auction");
  vibrate(100);
});

socket.on("auction:tick", ({ remaining }) => {
  $("#timer-seconds").textContent = remaining;
  $("#timer-bar").style.width = `${(remaining / timerTotal) * 100}%`;
  if (remaining <= 5) $("#timer-bar").style.background = "var(--danger)";
  else $("#timer-bar").style.background = "";
});

socket.on("auction:bidsUpdate", ({ bidsStatus }) => {
  const c = $("#bids-status");
  c.innerHTML = "";
  for (const [, done] of Object.entries(bidsStatus)) {
    const chip = document.createElement("span");
    chip.className = `bid-chip${done ? " done" : ""}`;
    chip.textContent = done ? "✓" : "···";
    c.appendChild(chip);
  }
});

function updateBidDisplay() {
  $("#bid-value").textContent = currentBid;
  $("#bid-slider").value = currentBid;
}

$("#bid-minus").addEventListener("click", () => {
  if (hasBid) return;
  currentBid = Math.max(0, currentBid - 1);
  updateBidDisplay();
  vibrate(20);
});

$("#bid-plus").addEventListener("click", () => {
  if (hasBid) return;
  currentBid = Math.min(maxBid, currentBid + 1);
  updateBidDisplay();
  vibrate(20);
});

$("#bid-slider").addEventListener("input", (e) => {
  if (hasBid) return;
  currentBid = parseInt(e.target.value, 10);
  updateBidDisplay();
});

$("#btn-bid").addEventListener("click", () => {
  if (hasBid) return;
  hasBid = true;
  socket.emit("auction:bid", { amount: currentBid }, (res) => {
    if (res.ok) {
      $("#bid-section").classList.add("hidden");
      $("#bid-placed").classList.remove("hidden");
      vibrate(50);
    }
  });
});

// ======================== RESOLVING (Roulette) ========================
socket.on("auction:resolving", (data) => {
  const track = $("#roulette-track");
  track.innerHTML = "";
  track.style.transition = "none";

  const names = data.playerNames.map((p) => p.name);
  const reps = Math.max(80, names.length * 20);
  const itemH = 80;

  for (let i = 0; i < reps; i++) {
    const div = document.createElement("div");
    div.className = "roulette-item";
    div.textContent = names[i % names.length];
    track.appendChild(div);
  }

  $("#resolving-severity").textContent = `${data.dare.severityEmoji} ${data.dare.severityLabel}`;
  $("#resolving-dare-text").textContent = data.dare.text;

  showScreen("resolving");
  vibrate(100);

  // One continuous position-based animation — like a real theme park wheel
  const targetIdx = reps - 5 - Math.floor(Math.random() * names.length);
  const targetPos = targetIdx * itemH;
  const willBounce = Math.random() < 0.45;
  const overshoot = willBounce ? itemH * (0.4 + Math.random() * 0.4) : 0;
  const duration = willBounce ? 7000 : 6500;
  const startTime = Date.now();
  let lastTickIdx = -1;

  // Split point: where wheel "stops" and bounce begins
  const split = 0.65;

  function getPosition(t) {
    if (!willBounce) {
      // Quadratic ease-out — sharp stop, no creeping
      const eased = 1 - (1 - t) * (1 - t);
      return targetPos * eased;
    }

    // With bounce: quadratic decelerate to overshoot, then ease back
    if (t < split) {
      const p = t / split;
      // Quadratic ease-out reaches target+overshoot with zero velocity at p=1
      const eased = 1 - (1 - p) * (1 - p);
      return (targetPos + overshoot) * eased;
    }

    // Bounce back immediately — smooth ease-in-out from overshoot to target
    const p = (t - split) / (1 - split);
    const eased = p * p * (3 - 2 * p); // smoothstep
    return (targetPos + overshoot) - overshoot * eased;
  }

  function animate() {
    const elapsed = Date.now() - startTime;
    const t = Math.min(elapsed / duration, 1);
    const pos = getPosition(t);

    track.style.transform = `translateY(-${pos}px)`;

    // Tick vibration when passing names in the slow part
    if (t > 0.6) {
      const currentIdx = Math.floor(pos / itemH);
      if (currentIdx !== lastTickIdx) {
        lastTickIdx = currentIdx;
        vibrate(8);
      }
    }

    if (t < 1) {
      requestAnimationFrame(animate);
    } else {
      // Snap to nearest name center
      const finalIdx = Math.round(pos / itemH);
      const snappedPos = finalIdx * itemH;
      track.style.transition = "transform 0.25s ease-out";
      track.style.transform = `translateY(-${snappedPos}px)`;

      const finalItem = track.children[finalIdx];
      if (finalItem) {
        setTimeout(() => {
          finalItem.classList.add("final");
          vibrate([80, 40, 80, 40, 150]);
        }, 250);
      }
    }
  }

  requestAnimationFrame(animate);
});

// ======================== REVEAL ========================
socket.on("auction:reveal", (data) => {
  // Dare
  $("#reveal-severity").textContent = `${data.dare.severityEmoji} ${data.dare.severityLabel}`;
  $("#reveal-dare-text").textContent = data.dare.text;

  // Loser
  const isMe = data.loserId === socket.id;
  $("#loser-name").textContent = isMe ? "DU!" : data.loserName;
  $("#loser-bid").textContent = `${data.bids.find((b) => b.isLoser)?.bid ?? 0} credits`;

  if (isMe) vibrate([100, 50, 100, 50, 200]);

  // Bids
  const bidsContainer = $("#reveal-bids");
  bidsContainer.innerHTML = "";
  data.bids.forEach((b) => {
    const row = document.createElement("div");
    row.className = `bid-row${b.isLoser ? " is-loser" : ""}`;
    row.innerHTML = `
      <span class="bid-row-name">${esc(b.name)}${b.isLoser ? " 💀" : ""}</span>
      <span class="bid-row-amount">${b.bid}</span>
    `;
    bidsContainer.appendChild(row);
  });

  // Scoreboard
  const scoreList = $("#scoreboard-list");
  scoreList.innerHTML = "";
  [...data.players].filter((p) => p.connected).sort((a, b) => b.budget - a.budget).forEach((p) => {
    const row = document.createElement("div");
    row.className = "score-row";
    row.innerHTML = `
      <span class="score-name">${esc(p.name)}</span>
      <span class="score-budget">💰 ${p.budget}</span>
    `;
    scoreList.appendChild(row);
  });

  const me = data.players.find((p) => p.id === socket.id);
  if (me) myBudget = me.budget;

  if (isHost) {
    $("#reveal-host-controls").classList.remove("hidden");
    $("#reveal-waiting").classList.add("hidden");
  } else {
    $("#reveal-host-controls").classList.add("hidden");
    $("#reveal-waiting").classList.remove("hidden");
  }

  showScreen("reveal");
});

$("#btn-next").addEventListener("click", () => {
  socket.emit("game:nextRound", null, (res) => {
    if (!res.ok && res.error) showToast(res.error);
  });
});

// ======================== VOTING ========================
socket.on("vote:start", (data) => {
  hasVoted = false;
  voteTimerTotal = data.timerSeconds;

  if (data.type === "approve") {
    $("#vote-type-label").textContent = "Ny dare föreslagen";
    $("#vote-dare-text").textContent = data.dareText;
    $("#vote-proposer").textContent = `Föreslagen av ${data.proposedBy}`;
    $("#vote-approve-btns").classList.remove("hidden");
    $("#vote-severity-btns").classList.add("hidden");
    $("#vote-waiting").classList.add("hidden");
  } else if (data.type === "severity") {
    $("#vote-type-label").textContent = "Välj svårighetsgrad";
    $("#vote-dare-text").textContent = data.dareText;
    $("#vote-proposer").textContent = "";
    $("#vote-approve-btns").classList.add("hidden");
    $("#vote-severity-btns").classList.remove("hidden");
    $("#vote-waiting").classList.add("hidden");
    // Reset selected state
    document.querySelectorAll(".sev-btn").forEach((b) => b.classList.remove("selected"));
  }

  $("#vote-timer-bar").style.width = "100%";
  $("#vote-overlay").classList.remove("hidden");
  vibrate(80);
});

socket.on("vote:tick", ({ remaining }) => {
  $("#vote-timer-bar").style.width = `${(remaining / voteTimerTotal) * 100}%`;
});

socket.on("vote:update", () => {
  // Could show vote count, keeping it simple
});

// Approve vote buttons
document.querySelectorAll("#vote-approve-btns .vote-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (hasVoted) return;
    hasVoted = true;
    const val = btn.dataset.vote === "yes";
    socket.emit("vote:cast", { value: val });
    $("#vote-approve-btns").classList.add("hidden");
    $("#vote-waiting").classList.remove("hidden");
    vibrate(30);
  });
});

// Severity vote buttons
document.querySelectorAll(".sev-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (hasVoted) return;
    hasVoted = true;
    const val = parseInt(btn.dataset.sev, 10);
    socket.emit("vote:cast", { value: val });
    document.querySelectorAll(".sev-btn").forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
    setTimeout(() => {
      $("#vote-severity-btns").classList.add("hidden");
      $("#vote-waiting").classList.remove("hidden");
    }, 300);
    vibrate(30);
  });
});

socket.on("vote:result", (data) => {
  $("#vote-overlay").classList.add("hidden");

  let text;
  if (data.type === "approve") {
    text = data.approved
      ? `👍 Godkänd! (${data.yesCount}/${data.totalVoters})`
      : `👎 Nekad (${data.yesCount}/${data.totalVoters})`;
  } else if (data.type === "severity") {
    text = `${data.severityEmoji} Svårighet: ${data.severityLabel}`;
  }

  $("#vote-result-text").textContent = text;
  $("#vote-result-overlay").classList.remove("hidden");
  vibrate(50);

  setTimeout(() => {
    $("#vote-result-overlay").classList.add("hidden");
  }, 2500);
});

socket.on("vote:done", ({ state }) => {
  // Return to the appropriate screen
  if (state === "lobby") {
    showScreen("lobby");
  } else if (state === "reveal") {
    showScreen("reveal");
  }
});

// ======================== CONNECTION ========================
socket.on("connect", () => {
  myId = socket.id;
});
