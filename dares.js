// Dare pool with severity tiers
// severity: 1 (mild) to 5 (brutal)
// Two modes: "pregame" (hemma/förfest) and "bar" (ute på bar)

const SEVERITY_WEIGHTS = { 1: 10, 2: 7, 3: 5, 4: 3, 5: 1 };

// === FÖRFEST (hemma) — inga köp, fokus på att dricka + socialt ===
const DARES_PREGAME = [
  // TIER 1: Mild
  { text: "Ta 3 klunkar", severity: 1 },
  { text: "Ta 5 klunkar", severity: 1 },
  { text: "Den till vänster om dig tar 3 klunkar", severity: 1 },
  { text: "Berätta din mest pinsamma historia", severity: 1 },
  { text: "Imitera en annan spelare — gruppen gissar vem", severity: 1 },
  { text: "Svara ärligt på en fråga från gruppen", severity: 1 },

  // TIER 2: Lätt
  { text: "Botten-upp", severity: 2 },
  { text: "Gör 10 armhävningar", severity: 2 },
  { text: "Waterfall — du startar, alla dricker tills personen före slutar", severity: 2 },
  { text: "Visa din senaste sökhistorik", severity: 2 },
  { text: "Skicka ett sms till din senaste kontakt: 'Jag tänker på dig'", severity: 2 },
  { text: "Låt gruppen välja en låt du måste dansa till i 30 sek", severity: 2 },

  // TIER 3: Medium
  { text: "Ta en shot", severity: 3 },
  { text: "Låt gruppen gå igenom din kamerarulle i 30 sekunder", severity: 3 },
  { text: "Ring en random kontakt och håll en konversation i 1 minut", severity: 3 },
  { text: "Byt tröja med en annan spelare resten av rundan", severity: 3 },
  { text: "Blanda en mystery-drink av det som finns — drick den", severity: 3 },
  { text: "Lägg upp en story på Instagram som gruppen bestämmer", severity: 3 },

  // TIER 4: Tuff
  { text: "Ta två shots efter varandra", severity: 4 },
  { text: "Låt gruppen skriva ett meddelande från din telefon till valfri kontakt", severity: 4 },
  { text: "Ring din senaste miss-call och håll igång samtalet i 2 min", severity: 4 },
  { text: "Du får bara prata i tredje person resten av kvällen", severity: 4 },
  { text: "Botten-upp och fyll på direkt", severity: 4 },

  // TIER 5: Brutal
  { text: "Ring din ex och säg att du saknar dem", severity: 5 },
  { text: "Låt gruppen lägga upp en bild på din Instagram", severity: 5 },
  { text: "Ta tre shots i rad", severity: 5 },
  { text: "Blanda den äckligaste drinken av det som finns hemma — drick allt", severity: 5 },
];

// === BAR (ute) — fokus på att köpa enheter, shots, sprit ===
const DARES_BAR = [
  // TIER 1: Mild
  { text: "Ta 3 klunkar", severity: 1 },
  { text: "Ta 5 klunkar", severity: 1 },
  { text: "Beställ din nästa drink med en accent", severity: 1 },
  { text: "Ge en komplimang till bartenderns", severity: 1 },
  { text: "Byt plats med den som sitter längst bort", severity: 1 },
  { text: "Svara ärligt på en fråga från gruppen", severity: 1 },

  // TIER 2: Lätt
  { text: "Köp en öl till valfri spelare", severity: 2 },
  { text: "Botten-upp din nuvarande drink", severity: 2 },
  { text: "Beställ en shot av Jägermeister — drick den", severity: 2 },
  { text: "Köp en cider till den som har lägst credits", severity: 2 },
  { text: "Beställ en drink du aldrig testat", severity: 2 },
  { text: "Bjud bartenderns på en compliment och en shot", severity: 2 },

  // TIER 3: Medium
  { text: "Köp en Fernet Branca till dig själv — botten-upp", severity: 3 },
  { text: "Beställ den äckligaste shotten baren har — drick den", severity: 3 },
  { text: "Köp en drink till spelaren med flest credits", severity: 3 },
  { text: "Ta en shot av Malört eller Underberg", severity: 3 },
  { text: "Köp en shot av Sambuca — drick utan att grimasera", severity: 3 },
  { text: "Beställ en Tequila utan lime och salt", severity: 3 },

  // TIER 4: Tuff
  { text: "Köp en shot till alla i gruppen", severity: 4 },
  { text: "Beställ en Cement Mixer (Baileys + lime) — drick allt", severity: 4 },
  { text: "Botten-upp din nuvarande drink och beställ en ny direkt", severity: 4 },
  { text: "Köp den dyraste shotten på menyn till dig själv", severity: 4 },
  { text: "Låt bartenderns välja en mystery-shot åt dig", severity: 4 },

  // TIER 5: Brutal
  { text: "Köp en hel runda till hela gruppen", severity: 5 },
  { text: "Köp shots till alla — bartenderns väljer sort", severity: 5 },
  { text: "Beställ en Prairie Oyster (ägg + tabasco) och drick", severity: 5 },
  { text: "Köp den dyraste drinken på menyn till den som har flest credits", severity: 5 },
];

const DARE_POOLS = {
  pregame: DARES_PREGAME,
  bar: DARES_BAR,
};

// Pick a random dare from the active mode pool + custom dares.
function pickRandomDare(mode = "pregame", usedKeys = [], customDares = []) {
  const baseDares = DARE_POOLS[mode] || DARES_PREGAME;

  const allDares = [
    ...baseDares.map((d, i) => ({ ...d, key: `${mode}:${i}` })),
    ...customDares.map((d, i) => ({ ...d, key: `cust:${i}` })),
  ];

  let available = allDares.filter((d) => !usedKeys.includes(d.key));
  if (available.length === 0) available = allDares;

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

module.exports = { DARES_PREGAME, DARES_BAR, DARE_POOLS, SEVERITY_WEIGHTS, pickRandomDare, getSeverityLabel, getSeverityEmoji };
