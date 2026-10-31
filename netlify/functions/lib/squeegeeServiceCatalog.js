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

// Actual Squeegee service labels shown by the owner on 31 October 2026.
// All four colours have 660L 4-weekly, 660L one-off and 1100L one-off.
// No 1100L 4-weekly service is shown; never substitute another size.
const LARGE_SERVICE_DESCRIPTIONS = Object.freeze({
  comm_gt660_4w: Object.freeze({
    660: Object.freeze({
      black: "Black 660L (4 weekly)",
      brown: "Brown 660L (4 weekly)",
      green: "Green 660L (4 weekly)",
      blue: "Blue 660L (4 weekly)",
    }),
  }),
  comm_gt660_oneoff: Object.freeze({
    660: Object.freeze({
      black: "Black 660L (one-off)",
      brown: "Brown 660L (one-off)",
      green: "Green 660L (one-off)",
      blue: "Blue 660L (one-off)",
    }),
    1100: Object.freeze({
      black: "Black 1100L (one-off)",
      brown: "Brown 1100L (one-off)",
      green: "Green 1100L (one-off)",
      blue: "Blue 1100L (one-off)",
    }),
  }),
});

function resolvedServiceIdForBin(serviceIds, bin) {
  const planId = String(bin?.planId || "");
  const type = String(bin?.type || "").trim().toLowerCase()
    .replace(/\s*bin\b/g, "").replace(/[^a-z]/g, "");
  if (!["black", "brown", "blue", "green"].includes(type)) return null;
  if (planId === "comm_gt660_4w" || planId === "comm_gt660_oneoff") {
    if (bin?.sizeLitres !== 660 && bin?.sizeLitres !== 1100) return null;
    return serviceIds?.[planId]?.[bin.sizeLitres]?.[type] || null;
  }
  return serviceIds?.[planId]?.[type] || null;
}
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
  for (const [planId, sizes] of Object.entries(LARGE_SERVICE_DESCRIPTIONS)) {
    serviceIds[planId] = {};
    for (const [size, descriptions] of Object.entries(sizes)) {
      serviceIds[planId][size] = {};
      for (const [binType, description] of Object.entries(descriptions)) {
        const candidates = byLabel.get(description) || [];
        if (candidates.length !== 1) {
          unresolved.push({
            planId, sizeLitres: Number(size), binType, description,
            reason: candidates.length ? "duplicate_service_label" : "missing_service_label",
          });
          continue;
        }
        try {
          serviceIds[planId][size][binType] = requireUuid(candidates[0].id, "serviceId");
        } catch {
          unresolved.push({
            planId, sizeLitres: Number(size), binType, description,
            reason: "invalid_service_id",
          });
        }
      }
    }
  }
  return { serviceIds, unresolved };
}

module.exports = {
  SERVICE_DESCRIPTIONS, LARGE_SERVICE_DESCRIPTIONS,
  resolveSqueegeeServiceIds, resolvedServiceIdForBin,
};
