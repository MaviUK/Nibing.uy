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
});

// No commercial-specific Squeegee services are identifiable from the
// retrieved labels. Fail closed for commercial until the owner maps them.
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
