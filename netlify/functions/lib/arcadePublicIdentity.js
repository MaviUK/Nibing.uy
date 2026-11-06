"use strict";
const crypto = require("node:crypto");

// Public leaderboard town labels are always drawn from a controlled list.
// Never echo a street, full address or postcode.
const TOWNS = Object.freeze([
  "Bangor", "Newtownards", "Donaghadee", "Holywood", "Comber",
  "Carrowdore", "Groomsport", "Millisle", "Portaferry", "Helens Bay",
  "Conlig", "Crawfordsburn", "Greyabbey", "Ballywalter",
  "Portavogie", "Cloughey", "Ballyhalbert", "Ballygowan",
  "Kircubbin", "Belfast", "Dundonald", "Moneyreagh", "Newtownbreda",
  "Ballyhackamore", "Helen's Bay", "Ballyrobert", "Ballyholme"
]);
const TOWN_LOOKUP = new Map(TOWNS.map(town => [
  town.toLowerCase().replace(/['’]/g, ""), town === "Helen's Bay" ? "Helens Bay" : town
]));

function canonicalTown(value) {
  if (typeof value !== "string" || value.length > 120) return null;
  const cleaned = value.trim()
    .replace(/\bBT\d{1,2}\s*\d[A-Z]{2}\b/ig, " ")
    .replace(/\b(?:county\s+down|co\.?\s+down|northern\s+ireland|united\s+kingdom|uk|ni)\b/ig, " ")
    .replace(/[().]+/g, " ")
    .replace(/\s+/g, " ")
    .trim().toLowerCase().replace(/['’]/g, "");
  return TOWN_LOOKUP.get(cleaned) || null;
}

function townFromAddress(address) {
  if (typeof address !== "string" || !address.trim() || address.length > 600)
    return "Town unavailable";

  // Address APIs normally separate the town with a comma or newline.
  const segments = address.replace(/\r/g, "\n").split(/[,\n]/);
  for (let i = segments.length - 1; i >= 0; i--) {
    const town = canonicalTown(segments[i]);
    if (town) return town;
  }

  // Single-line address: town must be the final word(s) before a BT postcode.
  // This does not match a street such as "Bangor Road" as the town.
  const match = /\bBT\d{1,2}\s*\d[A-Z]{2}\b/i.exec(address);
  if (match) {
    const before = address.slice(0, match.index).trim().replace(/[,\s]+$/, "");
    for (const town of [...TOWNS].sort((a, b) => b.length - a.length)) {
      const escaped = town.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      if (new RegExp("(?:^|\\s|,)" + escaped + "$", "i").test(before))
        return canonicalTown(town) || "Town unavailable";
    }
  }
  return "Town unavailable";
}

function publicCustomerReference(playerKey, secret = process.env.N64_PREVIEW_LEADERBOARD_SECRET) {
  // Stable site-owned alias, not a booking ID, email hash or Squeegee UUID.
  if (typeof playerKey !== "string" || !/^[a-f0-9]{64}$/.test(playerKey) ||
      typeof secret !== "string" || secret.length < 16) return null;
  return "NBG-" + crypto.createHmac("sha256", secret)
    .update("arcade-public-customer-ref:v1:" + playerKey)
    .digest("hex").slice(0, 10).toUpperCase();
}
function safePublicTown(value) {
  return canonicalTown(value) || "Town unavailable";
}
function safePublicReference(value) {
  return typeof value === "string" && /^NBG-[A-F0-9]{10}$/.test(value)
    ? value : null;
}

module.exports = {
  publicCustomerReference,
  townFromAddress,
  safePublicTown,
  safePublicReference
};
