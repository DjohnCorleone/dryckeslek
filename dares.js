// Dare pool with severity tiers
// severity: 1 (mild) to 5 (brutal)
// Weight is determined by severity — all dares of same severity have equal chance

const SEVERITY_WEIGHTS = { 1: 10, 2: 7, 3: 5, 4: 3, 5: 1 };

const DARES = [
  // === TIER 1: Mild ===
  { text: "Ta 3 klunkar", severity: 1 },
  { text: "Ta 5 klunkar", severity: 1 },
  { text: "Ge en komplimang till valfri spelare", severity: 1 },
  { text: "Berätta din mest pinsamma historia", severity: 1 },
  { text: "Imitera en annan spelare — gruppen gissar vem", severity: 1 },
  { text: "Ring en vän och sjung 'Grattis på födelsedagen'", severity: 1 },

  // === TIER 2: Lätt ===
  { text: "Byt plats med den som sitter längst bort", severity: 2 },
  { text: "Drick en botten-upp", severity: 2 },
  { text: "Gör 10 armhävningar nu direkt", severity: 2 },
  { text: "Låt gruppen välja din nästa drink", severity: 2 },
  { text: "Lägg upp en story på Instagram som gruppen bestämmer", severity: 2 },
  { text: "Skicka ett sms till din senaste kontakt: 'Jag tänker på dig'", severity: 2 },

  // === TIER 3: Medium ===
  { text: "Köp en öl till valfri spelare", severity: 3 },
  { text: "Gör din bästa dansrörelse i 30 sekunder", severity: 3 },
  { text: "Låt gruppen gå igenom din kamerarulle i 30 sekunder", severity: 3 },
  { text: "Ring en random kontakt och håll en konversation i 1 minut", severity: 3 },
  { text: "Byt tröja med en annan spelare resten av rundan", severity: 3 },
  { text: "Ta en shot", severity: 3 },

  // === TIER 4: Tuff ===
  { text: "Köp en drink till spelaren med flest credits", severity: 4 },
  { text: "Låt gruppen skriva ett meddelande från din telefon till valfri kontakt", severity: 4 },
  { text: "Botten-upp din nuvarande drink och beställ en ny", severity: 4 },
  { text: "Gör en karaoke-framträdande av valfri låt gruppen väljer", severity: 4 },
  { text: "Du får bara prata i tredje person resten av kvällen", severity: 4 },

  // === TIER 5: Brutal ===
  { text: "Köp en hel runda till hela gruppen!", severity: 5 },
  { text: "Ring din ex och säg att du saknar dem", severity: 5 },
  { text: "Köp shots till hela gruppen!", severity: 5 },
  { text: "Låt gruppen lägga upp en bild på din Instagram", severity: 5 },
];

// Pick a random dare from combined predefined + custom pool.
// All dares of the same severity have equal probability.
// Severity tiers are weighted by SEVERITY_WEIGHTS.
function pickRandomDare(usedKeys = [], customDares = []) {
  // Build unified pool
  const allDares = [
    ...DARES.map((d, i) => ({ ...d, key: `pre:${i}` })),
    ...customDares.map((d, i) => ({ ...d, key: `cust:${i}` })),
  ];

  // Filter out used dares
  let available = allDares.filter((d) => !usedKeys.includes(d.key));
  if (available.length === 0) available = allDares; // reset if all used

  // Assign weight based on severity
  const pool = available.map((d) => ({
    ...d,
    weight: SEVERITY_WEIGHTS[d.severity] || 5,
  }));

  const totalWeight = pool.reduce((sum, d) => sum + d.weight, 0);
  let roll = Math.random() * totalWeight;

  for (const dare of pool) {
    roll -= dare.weight;
    if (roll <= 0) return dare;
  }

  return pool[pool.length - 1];
}

function getSeverityLabel(severity) {
  return { 1: "Mild", 2: "Lätt", 3: "Medium", 4: "Tuff", 5: "Brutal" }[severity] || "???";
}

function getSeverityEmoji(severity) {
  return { 1: "😊", 2: "😅", 3: "😬", 4: "🔥", 5: "💀" }[severity] || "❓";
}

module.exports = { DARES, SEVERITY_WEIGHTS, pickRandomDare, getSeverityLabel, getSeverityEmoji };
