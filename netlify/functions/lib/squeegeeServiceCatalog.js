"use strict";

// Descriptions are from the owner's authenticated Squeegee GET /services on
// 30 October 2026. UUIDs are never guessed or committed to GitHub. Every
// actual UUID must be loaded from this Squeegee account at runtime.
const { requireUuid } = require("./squeegeeApiV3");

const SERVICE_DESCRIPTIONS = Object.freeze({
  domestic_4w: Object.freeze({
    black: "Black",
    brown: "Brown",
    green: "Green",
    blue: "Blue",
  }),
  domestic_oneoff: Object.freeze({
    black: "(One Off) Black",
    brown: "(One Off) Brown",
    green: "(One Off) Green",
    blue: "(One Off) Blue",
  }),
  // Under 360L: same bin colour, price and frequency as standard service.
  // The owner has no separate <360L service in the Squeegee catalogue.
  comm_lt360_4w: Object.freeze({
    black: "Black",
    brown: "Brown",
    green: "Green",
    blue: "Blue",
  }),
  comm_lt360_oneoff: Object.freeze({
    black: "(One Off) Black",
    brown: "(One Off) Brown",
    green: "(One Off) Green",
    blue: "(One Off) Blue",
  }),
});

// Large-bin options stay deliberately UNMAPPED: the website currently says
// >660L while the account has colour-specific 660L four-weekly and 1100L
// one-off services only. A generic >660L booking does not prove the bin is
// exactly 660L or 1100L. Never silently pick another size or colour.
function resolveSqueegeeServiceIds(services) {
  if (!Array.isArray(services)) throw new Error("Squeegee services must be an array");
  const byLabel = new Map();
  for (const service of services) {
    const label = String(service?.description || "").trim();
    if (!label) continue;
    const entries = byLabel.get(label) || [];
    entries.push(service);
    byLabel.set(label, entries);
  }

  const serviceIds = {};
  const unresolved = [];
  for (const [planId, descriptions] of Object.entries(SERVICE_DESCRIPTIONS)) {
    serviceIds[planId] = {};
    for (const [binType, description] of Object.entries(descriptions)) {
      const candidates = byLabel.get(description) || [];
      if (candidates.length !== 1) {
        unresolved.push({ planId, binType, description, reason: candidates.length ? "duplicate_service_label" : "missing_service_label" });
        continue;
      }
      try {
        serviceIds[planId][binType] = requireUuid(candidates[0].id, "serviceId");
      } catch {
        unresolved.push({ planId, binType, description, reason: "invalid_service_id" });
      }
    }
  }
  return { serviceIds, unresolved };
}

module.exports = { SERVICE_DESCRIPTIONS, resolveSqueegeeServiceIds };
