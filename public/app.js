const socket = io({
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 10000,
});

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
let gameMode = "pregame";
let swRegistration = null;
let myName = null;

// --- DOM helpers ---
const $ = (sel) => document.querySelector(sel);
const screens = document.querySelectorAll(".screen");

function showScreen(id) {
  screens.forEach((s) => s.classList.remove("active"));
  $(`#screen-${id}`).classList.add("active");
  // Show leave button on all screens except home
  $("#btn-leave").classList.toggle("hidden", id === "home");
}

function setDangerTheme(severity) {
  // Apply dark red background for severe dares (4-5)
  if (severity >= 5) {
    document.body.classList.add("theme-danger");
  } else {
    document.body.classList.remove("theme-danger");
  }
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

function updateRoomCodes() {
  document.querySelectorAll("[data-room-code]").forEach((el) => {
    el.textContent = roomCode || "";
  });
}

function getModeLabel(mode) {
  return mode === "bar" ? "🍻 Bar" : "🏠 Förfest";
}

function updateModeButtons() {
  const lobbyBtn = $("#btn-mode-lobby");
  const countdownBtn = $("#btn-mode-countdown");
  if (lobbyBtn) lobbyBtn.textContent = gameMode === "pregame" ? "🍻 Byt till Bar" : "🏠 Byt till Förfest";
  if (countdownBtn) countdownBtn.textContent = gameMode === "pregame" ? "🍻 Nu går vi ut" : "🏠 Tillbaka till förfesten";
}

// ======================== SERVICE WORKER + PUSH ========================
async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    swRegistration = await navigator.serviceWorker.register("/sw.js");
  } catch (e) {
    console.warn("SW registration failed:", e);
  }
}

async function subscribeToPush() {
  if (!swRegistration || !("PushManager" in window)) return;
  try {
    // Ask for notification permission
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return;

    // Get VAPID public key
    const res = await fetch("/api/push/vapid-key");
    const { publicKey } = await res.json();
    if (!publicKey) return;

    // Convert VAPID key
    const vapidBytes = urlBase64ToUint8Array(publicKey);

    // Subscribe
    const subscription = await swRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidBytes,
    });

    // Send to server
    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription, roomCode, playerId: socket.id }),
    });
  } catch (e) {
    console.warn("Push subscription failed:", e);
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Register SW on load
registerServiceWorker();

// ======================== URL PARAMS ========================
let hasRoomParam = false;
(function handleRoomParam() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("room");
  if (code) {
    hasRoomParam = true;
    const upperCode = code.toUpperCase();
    // Show shared layout, hide default
    $("#layout-default").classList.add("hidden");
    $("#layout-shared").classList.remove("hidden");
    $("#input-code-shared").value = upperCode;
    // Also set hidden default input for compatibility
    $("#input-code").value = upperCode;
    window.history.replaceState({}, "", window.location.pathname);
  }
})();

// ======================== HOW IT WORKS ========================
$("#btn-how").addEventListener("click", () => {
  $("#how-modal").classList.remove("hidden");
});
$("#btn-how-close").addEventListener("click", () => {
  $("#how-modal").classList.add("hidden");
});
$("#how-modal").addEventListener("click", (e) => {
  if (e.target === $("#how-modal")) $("#how-modal").classList.add("hidden");
});

// ======================== HOME ========================
// Shared layout buttons delegate to the same logic
$("#btn-create-shared")?.addEventListener("click", () => {
  // Switch back to default layout to create a room
  $("#layout-shared").classList.add("hidden");
  $("#layout-default").classList.remove("hidden");
  hasRoomParam = false;
  $("#input-code").value = "";
  $("#btn-create").click();
});

$("#btn-join-shared")?.addEventListener("click", () => {
  // Use the shared code
  $("#input-code").value = $("#input-code-shared").value;
  $("#btn-join").click();
});

$("#btn-create").addEventListener("click", () => {
  const name = $("#input-name").value.trim();
  if (!name) return ($("#home-error").textContent = "Skriv ditt namn!");
  $("#home-error").textContent = "";
  socket.emit("room:create", { playerName: name }, (res) => {
    if (res.ok) {
      myId = socket.id;
      myName = name;
      roomCode = res.roomCode;
      isHost = true;
      gameMode = res.mode || "pregame";
      renderLobby(res.players);
      updateModeButtons();
      updateRoomCodes();
      if (res.roundIntervalSec) {
        $("#input-interval").value = res.roundIntervalSec / 60;
      }
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
      myName = name;
      roomCode = res.roomCode;
      isHost = false;
      gameMode = res.mode || "pregame";
      customDares = res.customDares || [];
      renderLobby(res.players);
      renderCustomDares();
      updateModeButtons();
      updateRoomCodes();

      if (res.joinedMidGame || res.isReconnect) {
        // Joined/reconnected mid-game
        const me = res.players.find((p) => p.id === socket.id);
        if (me) myBudget = me.budget;
        if (me) isHost = res.players[0]?.id === socket.id;
        showToast(res.isReconnect ? `Välkommen tillbaka! 💰 ${me?.budget || 0}` : `Gick med! Du har ${me?.budget || 0} credits`);
        if (res.gameState === "auction" && res.auctionData) {
          showAuctionScreen(res.auctionData);
        } else if (res.gameState === "countdown") {
          showCountdownHostControls();
          updateRoomCodes();
          showScreen("countdown");
          socket.emit("game:ready");
        } else if (res.gameState === "waiting") {
          showScreen("waiting");
          socket.emit("game:ready");
        } else {
          showScreen("countdown");
          updateRoomCodes();
          updateCountdownDisplay(0);
        }
      } else {
        showScreen("lobby");
      }
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

// Interval input (host only)
$("#input-interval").addEventListener("change", () => {
  const minutes = parseFloat($("#input-interval").value.replace(",", "."));
  if (isNaN(minutes) || minutes < 0.5) return;
  const seconds = Math.round(minutes * 60);
  socket.emit("game:setInterval", { seconds }, (res) => {
    if (res?.ok) {
      $("#input-interval").value = res.seconds / 60;
    }
  });
});

socket.on("game:intervalChanged", ({ seconds }) => {
  $("#input-interval").value = seconds / 60;
});

// Mode toggle
function handleModeSwitch() {
  socket.emit("game:switchMode", null, (res) => {
    if (!res.ok && res.error) showToast(res.error);
  });
}
$("#btn-mode-lobby").addEventListener("click", handleModeSwitch);
$("#btn-mode-countdown").addEventListener("click", handleModeSwitch);

socket.on("game:modeChanged", ({ mode }) => {
  gameMode = mode;
  updateModeButtons();
  showToast(mode === "bar" ? "Nu kör vi bar-läge!" : "Tillbaka till förfesten!");
  vibrate(80);
});

// Start game
$("#btn-start").addEventListener("click", () => {
  socket.emit("game:start", null, (res) => {
    if (!res.ok) $("#lobby-error").textContent = res.error;
    else subscribeToPush(); // Subscribe to push when game starts
  });
});

socket.on("room:playerJoined", ({ players }) => {
  renderLobby(players);
  vibrate();
  showToast("Ny spelare!");
});

socket.on("room:playerLeft", ({ playerName, players, voluntary }) => {
  const active = document.querySelector(".screen.active")?.id;
  if (active === "screen-lobby") renderLobby(players);
  // Only show toast for voluntary leaves (click ✕), not passive disconnects
  if (voluntary) showToast(`${playerName} lämnade`);
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

  if (data.mode) gameMode = data.mode;
  $("#auction-mode-badge").textContent = getModeLabel(gameMode);
  $("#auction-round").textContent = data.roundNumber;
  $("#auction-budget").textContent = myBudget;
  $("#dare-text").textContent = data.dare.text;
  $("#dare-severity").textContent = `${data.dare.severityEmoji} ${data.dare.severityLabel}`;
  $("#dare-card").className = `dare-card${data.dare.severity >= 4 ? " sev-danger" : ""}`;

  timerTotal = data.timerSeconds;
  $("#timer-seconds").textContent = timerTotal;
  $("#timer-bar").style.width = "100%";

  updateBidDisplay();
  $("#bid-slider").max = maxBid;
  $("#bid-slider").value = 0;
  $("#bid-section").classList.remove("hidden");
  $("#bid-placed").classList.add("hidden");
  $("#bids-status").innerHTML = "";

  // Hide sudden death overlay if present, restore header
  $("#sd-overlay").classList.add("hidden");
  $(".auction-header").classList.remove("hidden");

  setDangerTheme(data.dare.severity);
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
  const entries = Object.entries(bidsStatus);
  const total = entries.length;
  const done = entries.filter(([, d]) => d).length;
  const c = $("#bids-status");
  c.innerHTML = `<span class="bids-counter">${done}/${total}</span>`;
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

// Helper: show auction screen from reconnect data
function showAuctionScreen(data) {
  hasBid = false;
  currentBid = 0;

  const me = data.players.find((p) => p.id === socket.id);
  myBudget = me ? me.budget : 0;
  maxBid = myBudget;

  if (data.mode) gameMode = data.mode;

  if (data.isSuddenDeath && data.suddenDeathPlayers) {
    const amParticipant = data.suddenDeathPlayers.includes(socket.id);
    $("#auction-mode-badge").textContent = "SUDDEN DEATH";
    $("#auction-round").textContent = data.roundNumber;
    $("#auction-budget").textContent = myBudget;
    $("#dare-text").textContent = data.dare.text;
    $("#dare-severity").textContent = `${data.dare.severityEmoji} ${data.dare.severityLabel}`;
    $("#dare-card").className = `dare-card${data.dare.severity >= 4 ? " sev-danger" : ""}`;
    timerTotal = data.timerSeconds || 15;
    $("#timer-seconds").textContent = timerTotal;
    $("#timer-bar").style.width = "100%";
    if (amParticipant) {
      updateBidDisplay();
      $("#bid-slider").max = maxBid;
      $("#bid-slider").value = 0;
      $("#bid-section").classList.remove("hidden");
      $("#bid-placed").classList.add("hidden");
    } else {
      $("#bid-section").classList.add("hidden");
      $("#bid-placed").classList.remove("hidden");
      $(".bid-confirmed").textContent = `Sudden Death: ${(data.tiedNames || []).join(" vs ")}`;
    }
    $(".auction-header").classList.add("hidden");
    const sdOverlay = $("#sd-overlay");
    $("#sd-player-left").textContent = (data.tiedNames || [])[0] || "";
    $("#sd-player-right").textContent = (data.tiedNames || [])[1] || "";
    sdOverlay.classList.remove("hidden");
  } else {
    $("#auction-mode-badge").textContent = getModeLabel(gameMode);
    $("#auction-round").textContent = data.roundNumber;
    $("#auction-budget").textContent = myBudget;
    $("#dare-text").textContent = data.dare.text;
    $("#dare-severity").textContent = `${data.dare.severityEmoji} ${data.dare.severityLabel}`;
    $("#dare-card").className = `dare-card${data.dare.severity >= 4 ? " sev-danger" : ""}`;
    timerTotal = data.timerSeconds || 30;
    $("#timer-seconds").textContent = timerTotal;
    $("#timer-bar").style.width = "100%";
    updateBidDisplay();
    $("#bid-slider").max = maxBid;
    $("#bid-slider").value = 0;
    $("#bid-section").classList.remove("hidden");
    $("#bid-placed").classList.add("hidden");
    $("#sd-overlay").classList.add("hidden");
    $(".auction-header").classList.remove("hidden");
  }

  $("#bids-status").innerHTML = "";
  setDangerTheme(data.dare.severity);
  showScreen("auction");
}

// ======================== RESOLVING (Roulette) ========================
socket.on("auction:resolving", (data) => {
  // Hide sudden death overlay so it doesn't push the spinner down on mobile
  $("#sd-overlay").classList.add("hidden");

  const track = $("#roulette-track");
  track.innerHTML = "";
  track.style.transition = "none";

  const names = data.playerNames.map((p) => p.name);
  const isTie = data.isTie;
  const tiedNames = data.tiedNames || [];
  const reps = Math.max(80, names.length * 20);
  const itemH = 80;

  // For ties, arrange names so two tied players are adjacent near the end
  let orderedNames = names;
  if (isTie && tiedNames.length >= 2) {
    // Ensure the two tied players appear next to each other in the cycle
    const others = names.filter((n) => !tiedNames.includes(n));
    orderedNames = [...others, ...tiedNames];
  }

  for (let i = 0; i < reps; i++) {
    const div = document.createElement("div");
    div.className = "roulette-item";
    div.textContent = orderedNames[i % orderedNames.length];
    track.appendChild(div);
  }

  $("#resolving-severity").textContent = `${data.dare.severityEmoji} ${data.dare.severityLabel}`;
  $("#resolving-dare-text").textContent = data.dare.text;

  // Hide/show tie label
  const tieLabel = $("#resolving-tie-label");
  if (tieLabel) tieLabel.classList.add("hidden");

  setDangerTheme(data.dare.severity);
  showScreen("resolving");
  vibrate(100);

  let targetIdx;
  if (isTie && tiedNames.length >= 2) {
    // Find the last occurrence of the first tied player near the end
    // Land between the two tied players (half-item offset)
    const cycleLen = orderedNames.length;
    const firstTiedIdx = orderedNames.indexOf(tiedNames[0]);
    // Find the position near the end of the track where tied players are adjacent
    const baseIdx = reps - cycleLen + firstTiedIdx;
    targetIdx = baseIdx;
  } else {
    targetIdx = reps - 5 - Math.floor(Math.random() * names.length);
  }

  // For tie: offset by half an item to land between the two names
  const targetPos = isTie
    ? targetIdx * itemH + itemH * 0.5
    : targetIdx * itemH;

  const willBounce = !isTie && Math.random() < 0.45;
  const overshoot = willBounce ? itemH * (0.4 + Math.random() * 0.4) : 0;
  const duration = willBounce ? 7000 : isTie ? 7500 : 6500;
  const startTime = Date.now();
  let lastTickIdx = -1;

  const split = 0.65;

  function getPosition(t) {
    if (!willBounce) {
      const eased = 1 - (1 - t) * (1 - t);
      return targetPos * eased;
    }
    if (t < split) {
      const p = t / split;
      const eased = 1 - (1 - p) * (1 - p);
      return (targetPos + overshoot) * eased;
    }
    const p = (t - split) / (1 - split);
    const eased = p * p * (3 - 2 * p);
    return (targetPos + overshoot) - overshoot * eased;
  }

  function animate() {
    const elapsed = Date.now() - startTime;
    const t = Math.min(elapsed / duration, 1);
    const pos = getPosition(t);

    track.style.transform = `translateY(-${pos}px)`;

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
      if (isTie) {
        // Don't snap — stay between the two names
        vibrate([100, 50, 100, 50, 100, 50, 200]);
        if (tieLabel) {
          tieLabel.textContent = `SUDDEN DEATH — ${tiedNames.join(" vs ")}`;
          tieLabel.classList.remove("hidden");
        }
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
  }

  requestAnimationFrame(animate);
});

// ======================== SUDDEN DEATH ========================
socket.on("auction:suddenDeath", (data) => {
  hasBid = false;
  currentBid = 0;

  const me = data.players.find((p) => p.id === socket.id);
  myBudget = me ? me.budget : 0;
  maxBid = myBudget;

  const amParticipant = data.tiedPlayers.includes(socket.id);

  if (data.mode) gameMode = data.mode;
  $("#auction-mode-badge").textContent = "SUDDEN DEATH";
  $("#auction-round").textContent = data.roundNumber;
  $("#auction-budget").textContent = myBudget;
  $("#dare-text").textContent = data.dare.text;
  $("#dare-severity").textContent = `${data.dare.severityEmoji} ${data.dare.severityLabel}`;
  $("#dare-card").className = `dare-card${data.dare.severity >= 4 ? " sev-danger" : ""}`;

  timerTotal = data.timerSeconds;
  $("#timer-seconds").textContent = timerTotal;
  $("#timer-bar").style.width = "100%";

  if (amParticipant) {
    updateBidDisplay();
    $("#bid-slider").max = maxBid;
    $("#bid-slider").value = 0;
    $("#bid-section").classList.remove("hidden");
    $("#bid-placed").classList.add("hidden");
  } else {
    $("#bid-section").classList.add("hidden");
    $("#bid-placed").classList.remove("hidden");
    $(".bid-confirmed").textContent = `Sudden Death: ${data.tiedNames.join(" vs ")}`;
  }

  $("#bids-status").innerHTML = "";

  // Show sudden death face-off overlay, hide normal header
  $(".auction-header").classList.add("hidden");
  const sdOverlay = $("#sd-overlay");
  $("#sd-player-left").textContent = data.tiedNames[0] || "";
  $("#sd-player-right").textContent = data.tiedNames[1] || "";
  sdOverlay.classList.remove("hidden");

  setDangerTheme(data.dare.severity);
  showScreen("auction");
  vibrate([150, 50, 150]);
});

// ======================== REVEAL ========================
socket.on("auction:reveal", (data) => {
  $("#reveal-severity").textContent = `${data.dare.severityEmoji} ${data.dare.severityLabel}`;
  $("#reveal-dare-text").textContent = data.dare.text;

  const isMe = data.loserId === socket.id;
  $("#loser-name").textContent = isMe ? "DU!" : data.loserName;
  $("#loser-bid").textContent = `${data.bids.find((b) => b.isLoser)?.bid ?? 0} credits`;

  if (isMe) vibrate([100, 50, 100, 50, 200]);

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

  // Show auto-hint (no host controls needed on reveal now)
  $("#reveal-auto-hint").classList.remove("hidden");

  setDangerTheme(0); // Clear danger theme on reveal
  $("#sd-overlay").classList.add("hidden"); // Hide SD overlay
  showScreen("reveal");

  // Kick prompts are sent via kick:vote from the server for defaulted players
});

// Reveal pause — show countdown in the hint
socket.on("game:revealPause", ({ seconds }) => {
  let remaining = seconds;
  const el = $("#reveal-countdown");
  if (el) el.textContent = `${remaining}s`;

  if (window._revealCountdownTimer) clearInterval(window._revealCountdownTimer);
  window._revealCountdownTimer = setInterval(() => {
    remaining--;
    if (el) el.textContent = remaining > 0 ? `${remaining}s` : "";
    if (remaining <= 0) clearInterval(window._revealCountdownTimer);
  }, 1000);
});

// ======================== COUNTDOWN ========================
socket.on("game:countdownStart", ({ total, remaining }) => {
  updateCountdownDisplay(remaining);
  showCountdownHostControls();
  setDangerTheme(0);
  $("#sd-overlay").classList.add("hidden");
  updateRoomCodes();
  showScreen("countdown");

  // Auto-send ready signal
  socket.emit("game:ready");
});

socket.on("game:countdownTick", ({ remaining }) => {
  updateCountdownDisplay(remaining);
});

function updateCountdownDisplay(remaining) {
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  $("#countdown-minutes").textContent = mins;
  $("#countdown-secs").textContent = secs.toString().padStart(2, "0");
}

function showCountdownHostControls() {
  if (isHost) {
    $("#countdown-host-controls").classList.remove("hidden");
    updateModeButtons();
  } else {
    $("#countdown-host-controls").classList.add("hidden");
  }
}

// ======================== WAITING FOR PLAYERS ========================
socket.on("game:waitingForPlayers", ({ missing }) => {
  const container = $("#waiting-missing");
  container.innerHTML = "";
  missing.forEach((name) => {
    const chip = document.createElement("div");
    chip.className = "waiting-chip";
    chip.textContent = name;
    container.appendChild(chip);
  });

  if (isHost) {
    $("#waiting-host-controls").classList.remove("hidden");
    $("#waiting-hint").classList.add("hidden");
  } else {
    $("#waiting-host-controls").classList.add("hidden");
    $("#waiting-hint").classList.remove("hidden");
  }

  showScreen("waiting");

  // Auto-send ready signal (we're here, so we're ready)
  socket.emit("game:ready");
});

// Force start (host)
$("#btn-force-start").addEventListener("click", () => {
  socket.emit("game:forceStart", null, (res) => {
    if (!res.ok && res.error) showToast(res.error);
  });
});

// End game buttons
$("#btn-end-game").addEventListener("click", () => {
  socket.emit("game:end", null, (res) => {
    if (!res.ok && res.error) showToast(res.error);
  });
});

$("#btn-end-game-waiting").addEventListener("click", () => {
  socket.emit("game:end", null, (res) => {
    if (!res.ok && res.error) showToast(res.error);
  });
});

// Leave room
$("#btn-leave").addEventListener("click", () => {
  socket.emit("room:leave", null, () => {
    roomCode = null;
    myName = null;
    isHost = false;
    myBudget = 0;
    customDares = [];
    setDangerTheme(0);
    $("#sd-overlay").classList.add("hidden");
    showScreen("home");
  });
});

// Game ended → back to lobby
socket.on("game:ended", ({ players }) => {
  renderLobby(players);
  updateModeButtons();
  showScreen("lobby");
  showToast("Spelet avslutat");
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
    document.querySelectorAll(".sev-btn").forEach((b) => b.classList.remove("selected"));

    // Show probability weights
    if (data.weights) {
      const totalWeight = Object.values(data.weights).reduce((a, b) => a + b, 0);
      document.querySelectorAll(".sev-btn").forEach((btn) => {
        const sev = btn.dataset.sev;
        const w = data.weights[sev] || 0;
        const pct = Math.round((w / totalWeight) * 100);
        const label = btn.querySelector(".sev-pct");
        if (label) label.textContent = `${pct}%`;
      });
    }
  }

  $("#vote-timer-bar").style.width = "100%";
  $("#vote-overlay").classList.remove("hidden");
  vibrate(80);
});

socket.on("vote:tick", ({ remaining }) => {
  $("#vote-timer-bar").style.width = `${(remaining / voteTimerTotal) * 100}%`;
});

socket.on("vote:update", () => {});

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
  if (state === "lobby") {
    showScreen("lobby");
  } else if (state === "reveal") {
    showScreen("reveal");
  } else if (state === "countdown") {
    showScreen("countdown");
  }
});

// ======================== CONNECTION ========================
socket.on("connect", () => {
  const oldId = myId;
  myId = socket.id;

  // Auto-rejoin room after reconnect (e.g. phone woke from background)
  if (roomCode && myName && oldId && oldId !== myId) {
    socket.emit("room:join", { roomCode, playerName: myName }, (res) => {
      if (res.ok) {
        const me = res.players.find((p) => p.id === socket.id);
        if (me) myBudget = me.budget;
        isHost = res.players[0]?.id === socket.id;
        gameMode = res.mode || gameMode;
        customDares = res.customDares || [];

        if (res.gameState === "lobby") {
          renderLobby(res.players);
          updateModeButtons();
          updateRoomCodes();
          showScreen("lobby");
        } else if (res.gameState === "countdown") {
          showCountdownHostControls();
          updateRoomCodes();
          showScreen("countdown");
          socket.emit("game:ready");
        } else if (res.gameState === "waiting") {
          showScreen("waiting");
          socket.emit("game:ready");
        } else if (res.gameState === "auction" && res.auctionData) {
          showAuctionScreen(res.auctionData);
        } else {
          // resolving/reveal — wait for next server event
          showScreen("countdown");
          updateRoomCodes();
          updateCountdownDisplay(0);
          socket.emit("game:ready");
        }
        showToast("Återansluten!");
        subscribeToPush();
      } else {
        // Room gone or name conflict — go home
        roomCode = null;
        myName = null;
        showScreen("home");
      }
    });
  }
});

// ======================== KICK VOTE ========================
function showKickPrompt(targetId, targetName) {
  // Remove any existing kick prompt
  document.querySelectorAll(".kick-prompt-overlay").forEach((el) => el.remove());

  const overlay = document.createElement("div");
  overlay.className = "kick-prompt-overlay";
  overlay.innerHTML = `
    <div class="kick-prompt-card">
      <p class="kick-prompt-text">${esc(targetName)} deltog inte i budgivningen.</p>
      <p class="kick-prompt-question">Har spelaren lämnat?</p>
      <div class="kick-prompt-btns">
        <button class="btn btn-outline kick-btn" data-vote="yes">Ja, kicka</button>
        <button class="btn btn-outline kick-btn" data-vote="no">Nej, behåll</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelectorAll(".kick-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const vote = btn.dataset.vote === "yes";
      socket.emit("kick:cast", { targetId, vote });
      overlay.remove();
    });
  });

  // Auto-dismiss after 15 seconds
  setTimeout(() => {
    if (overlay.parentNode) overlay.remove();
  }, 15000);
}

socket.on("kick:vote", ({ targetId, targetName }) => {
  showKickPrompt(targetId, targetName);
});

socket.on("kick:result", ({ targetName, kicked }) => {
  document.querySelectorAll(".kick-prompt-overlay").forEach((el) => el.remove());
  showToast(kicked ? `${targetName} sparkades` : `${targetName} stannar kvar`);
});

socket.on("kick:removed", () => {
  roomCode = null;
  myName = null;
  isHost = false;
  myBudget = 0;
  customDares = [];
  setDangerTheme(0);
  $("#sd-overlay").classList.add("hidden");
  showScreen("home");
  showToast("Du har blivit kickad");
});

// Handle mobile app resume — force reconnect if socket died silently
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && roomCode && myName) {
    if (!socket.connected) {
      // Socket died while in background — reconnect
      socket.connect();
    } else {
      // Socket still connected but may have missed events — re-emit ready
      socket.emit("game:ready");
    }
  }
});
