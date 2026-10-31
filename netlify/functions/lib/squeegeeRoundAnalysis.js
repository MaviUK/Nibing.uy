"use strict";

/**
 * Short-lived, read-only analysis of historic Squeegee job-group assignments.
 * Returns ONLY aggregate town/group counts, never customer records/IDs.
 * A suggested town is not proof of a round's weekday or recurrence.
 */
const TOWNS = Object.freeze([
  "Bangor", "Holywood", "Newtownards", "Donaghadee",
  "Carrowdore", "Comber", "Millisle", "Portaferry",
]);

function getAddressText(row) {
  const addr = row?.address;
  if (typeof addr === "string") return addr;
  if (!addr || typeof addr !== "object") return "";
  return String(addr.addressDescription || addr.text || "");
}
function townFromAddress(addr) {
  const value = String(addr || "").toUpperCase()
    .replace(/[.,'’()-]/g, " ").replace(/\s+/g, " ").trim();
  const matches = TOWNS.filter(town =>
    new RegExp("(?:^|\\s)" + town.toUpperCase() + "(?:\\s|$)").test(value));
  return matches.length === 1 ? matches[0] : null;
}
function groupIdFromJob(job) {
  const value = job?.jobGroup;
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    return String(value._id || value.id || "").trim();
  }
  return "";
}
function analyzeSqueegeeTownGroups(groups, customers, { minCell = 5, minDominant = 10, minShare = 0.85 } = {}) {
  if (!Array.isArray(groups) || !Array.isArray(customers)) throw new TypeError("Expected arrays");
  const groupById = new Map();
  for (const group of groups) {
    if (!group?.id || !group?.description) continue;
    const id = String(group.id).trim();
    const label = String(group.description).trim();
    if (!id || !label) continue;
    groupById.set(id, label);
  }

  const counts = new Map();
  const townCustomers = new Set();
  let groupAssignments = 0;
  let unresolvedGroupAssignments = 0;
  let unknownTownAssignments = 0;
  let classifiedCustomers = 0;

  // Deduplicate by customer ID: one property with 3 different bins in one
  // group should count only once, not three times.
  const seenCustomerGroup = new Set();
  for (const customer of customers) {
    const customerId = String(customer?._id || "");
    if (!customerId) continue;
    const town = townFromAddress(getAddressText(customer));
    if (town) { townCustomers.add(customerId); classifiedCustomers++; }
    const jobs = Array.isArray(customer?.jobs) ? customer.jobs : [];
    for (const job of jobs) {
      const groupId = groupIdFromJob(job);
      if (!groupId) continue;
      const dedupeKey = customerId + "\u001f" + groupId;
      if (seenCustomerGroup.has(dedupeKey)) continue;
      seenCustomerGroup.add(dedupeKey);
      const label = groupById.get(groupId);
      if (!label) { unresolvedGroupAssignments++; continue; }
      groupAssignments++;
      if (!town) { unknownTownAssignments++; continue; }
      const entry = counts.get(groupId) || { label, distribution: new Map(), knownTotal: 0 };
      entry.knownTotal++;
      entry.distribution.set(town, (entry.distribution.get(town) || 0) + 1);
      counts.set(groupId, entry);
    }
  }

  const groupSummaries = [...groupById].map(([id, label]) => {
    const entry = counts.get(id) || { knownTotal: 0, distribution: new Map() };
    const ranked = [...entry.distribution].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const top = ranked[0] || [null, 0];
    const confidence = entry.knownTotal ? top[1] / entry.knownTotal : 0;
    return {
      group: label,
      classifiedCustomers: entry.knownTotal,
      // Suppress small groups/cells, including minority counts and unknowns.
      towns: ranked.filter(([, n]) => n >= minCell).map(([town, customers]) => ({ town, customers })),
      // This is a hypothesis only. Staff still need to confirm actual rounds.
      suggestedTown: top[1] >= minDominant && confidence >= minShare ? top[0] : null,
      suggestedTownShare: top[1] >= minDominant && confidence >= minShare
        ? Math.round(confidence * 100) : null,
    };
  }).sort((a, b) => a.group.localeCompare(b.group, undefined, { numeric: true }));

  return {
    readOnly: true,
    noAutomaticRoundMapping: true,
    minReportedTownCount: minCell,
    groupsScanned: groupById.size,
    customerRecordsInspected: customers.length,
    customersWithRecognizedTowns: townCustomers.size,
    customerGroupAssignments: groupAssignments,
    unknownTownAssignments,
    unresolvedGroupAssignments,
    groups: groupSummaries,
  };
}

module.exports = { analyzeSqueegeeTownGroups, townFromAddress, groupIdFromJob };
