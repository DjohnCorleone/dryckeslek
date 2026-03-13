// Dare pool with severity tiers
// severity: 1 (mild) to 4 (hemsk)
// Two modes: "pregame" (hemma/förfest) and "bar" (ute på bar)

// Category weights — probability stays constant regardless of dare count per tier
// ~1/3 mild, ~1/5 medel, ~1/10 tuff, ~1/20 hemsk (normalized: 20:12:6:3)
const CATEGORY_WEIGHTS = { 1: 20, 2: 12, 3: 6, 4: 3 };

// === FÖRFEST (hemma) — inga köp, fokus på att dricka + socialt ===
const DARES_PREGAME = [
  // TIER 1: Mild (~1/3)
  { text: "Ta 5 klunkar", severity: 1 },
  { text: "Botten-upp din drink", severity: 1 },
  { text: "Svara ärligt på en fråga från gruppen", severity: 1 },
  { text: "Berätta din mest pinsamma historia", severity: 1 },
  { text: "Imitera en annan spelare — gruppen gissar vem", severity: 1 },

  // TIER 2: Medel (~1/5)
  { text: "Ta en shot", severity: 2 },
  { text: "Visa din senaste sökhistorik", severity: 2 },
  { text: "Ring en random kontakt och håll samtalet i 1 minut", severity: 2 },
  { text: "Blanda en mystery-drink av det som finns — drick den", severity: 2 },

  // TIER 3: Tuff (~1/10)
  { text: "Ta två shots efter varandra", severity: 3 },
  { text: "Låt gruppen skriva ett meddelande från din telefon till valfri kontakt", severity: 3 },
  { text: "Lägg upp en story på Instagram som gruppen bestämmer", severity: 3 },

  // TIER 4: Hemsk (~1/20)
  { text: "Ring din ex och säg att du saknar dem", severity: 4 },
  { text: "Ta tre shots i rad", severity: 4 },
  { text: "Låt gruppen lägga upp en bild på din Instagram", severity: 4 },
];

// === BAR (ute) — fokus på att köpa enheter, shots, sprit ===
const DARES_BAR = [
  // TIER 1: Mild (~1/3)
  { text: "Köp en öl till någon i gruppen", severity: 1 },
  { text: "Köp 2 shots till dig själv", severity: 1 },
  { text: "Svep din nuvarande drink", severity: 1 },
  { text: "Köp en cider eller drink till valfri spelare", severity: 1 },

  // TIER 2: Medel (~1/5)
  { text: "Få ett nummer av en person vald av gruppen", severity: 2 },
  { text: "Gå fram till en främling och håll en konversation i 2 minuter", severity: 2 },
  { text: "Köp en shot till dig själv och till spelaren med flest credits", severity: 2 },
  { text: "Beställ din nästa drink med accent — behåll accenten i 10 min", severity: 2 },

  // TIER 3: Tuff (~1/10)
  { text: "Köp en shot till alla i gruppen", severity: 3 },
  { text: "Köp en öl till alla i gruppen", severity: 3 },
  { text: "Låt bartendern blanda en mystery-shot åt dig — drick den", severity: 3 },

  // TIER 4: Hemsk (~1/20)
  { text: "Köp en rund shots och öl till alla", severity: 4 },
  { text: "Köp den dyraste drinken på menyn åt någon gruppen väljer", severity: 4 },
  { text: "Svep din nuvarande drink och beställ en ny direkt", severity: 4 },
];

const DARE_POOLS = {
  pregame: DARES_PREGAME,
  bar: DARES_BAR,
};

// Shot wheel options
const SHOT_WHEEL = [
  "Jägermeister",
  "Tequila",
  "Sambuca",
  "Fernet Branca",
  "Fireball",
  "Vodka",
  "Whiskey",
  "Rom",
  "Limoncello",
  "Minttu",
  "Grappa",
  "Baileys",
  "Kahlúa",
  "Grön Chartreuse",
];

// Pick a random dare from the active mode pool + custom dares.
// Uses category-based weighting so probabilities stay constant per tier.
function pickRandomDare(mode = "pregame", usedKeys = [], customDares = []) {
  const baseDares = DARE_POOLS[mode] || DARES_PREGAME;

  const allDares = [
    ...baseDares.map((d, i) => ({ ...d, key: `${mode}:${i}` })),
    ...customDares.map((d, i) => ({ ...d, key: `cust:${i}` })),
  ];

  // Group dares by severity
  const bySeverity = {};
  for (const d of allDares) {
    if (!bySeverity[d.severity]) bySeverity[d.severity] = [];
    bySeverity[d.severity].push(d);
  }

  // Pick category based on fixed weights
  const categories = Object.keys(bySeverity).map(Number);
  const totalCatWeight = categories.reduce((sum, s) => sum + (CATEGORY_WEIGHTS[s] || 1), 0);
  let roll = Math.random() * totalCatWeight;
  let chosenSeverity = categories[0];
  for (const s of categories) {
    roll -= CATEGORY_WEIGHTS[s] || 1;
    if (roll <= 0) { chosenSeverity = s; break; }
  }

  // Pick random dare within chosen category, preferring unused
  let pool = bySeverity[chosenSeverity];
  const unused = pool.filter((d) => !usedKeys.includes(d.key));
  if (unused.length > 0) pool = unused;

  return pool[Math.floor(Math.random() * pool.length)];
}

function getSeverityLabel(severity) {
  return { 1: "Mild", 2: "Medel", 3: "Tuff", 4: "Hemsk" }[severity] || "???";
}

function getSeverityEmoji(severity) {
  return { 1: "😅", 2: "😬", 3: "🔥", 4: "💀" }[severity] || "❓";
}

module.exports = { DARES_PREGAME, DARES_BAR, DARE_POOLS, CATEGORY_WEIGHTS, SHOT_WHEEL, pickRandomDare, getSeverityLabel, getSeverityEmoji };
