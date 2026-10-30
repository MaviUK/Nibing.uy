"use strict";

/**
 * NI Bin Guy -> Squeegee API v3 (documented public endpoints only).
 * Source: https://api02.sqgee.com/api/v3/docs (reviewed 2026-10-30).
 *
 * This module is never imported by browser code. No Squeegee writes are
 * permitted until owner approval AND a durable idempotency ledger are ready.
 */
const API_ORIGIN = "https://api02.sqgee.com";
const PREFIX = "/api/v3/public";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class SqueegeeApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "SqueegeeApiError";
    this.status = status || 0;
    this.code = code || null;
  }
}

function assertWriteAllowed() {
  // Write protection is deliberately stricter than possession of an API key.
  // Never set these switches before approved testing, correct service mapping
  // and an atomic booking/job idempotency ledger have been verified.
  const allowed = process.env.SQUEEGEE_WRITE_ENABLED === "true" &&
    process.env.SQUEEGEE_OWNER_APPROVED_WRITES === "true" &&
    process.env.SQUEEGEE_ATOMIC_LEDGER_READY === "true" &&
    process.env.CONTEXT === "deploy-preview" &&
    process.env.REVIEW_ID === "77";
  if (!allowed) throw new Error("Squeegee writes are disabled for this deployment");
}

function requireUuid(value, field) {
  const id = String(value || "").trim();
  if (!UUID_RE.test(id)) throw new Error(field + " must be a UUID");
  return id;
}

async function request(method, path, { query, body, timeoutMs = 15000 } = {}) {
  if (!["GET", "POST"].includes(method) || !path.startsWith(PREFIX + "/") ||
      /[?#]/.test(path) || path.includes("..")) {
    throw new Error("Unsupported Squeegee API operation");
  }

  const apiKey = String(process.env.SQUEEGEE_API_KEY || "").trim();
  if (!apiKey) throw new Error("Squeegee API key has not been configured");

  const url = new URL(path, API_ORIGIN);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: method === "POST" ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      redirect: "error",
    });

    // Keep API keys, customer PII, returned records and upstream response bodies
    // out of logs and public error messages.
    const json = await response.json().catch(() => null);
    if (!response.ok || !json || json.success !== true) {
      throw new SqueegeeApiError(
        "Squeegee returned an unsuccessful response",
        response.status,
        Number.isInteger(json?.code) ? json.code : null
      );
    }
    return json;
  } catch (error) {
    if (error?.name === "AbortError") throw new SqueegeeApiError("Squeegee timed out", 0);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function listCustomers({ page = 1, pagedRequestId } = {}) {
  if (!Number.isInteger(page) || page < 1) throw new Error("page must be >= 1");
  return (await request("GET", PREFIX + "/customers", {
    query: { page, pagedRequestId },
  })).data;
}

async function getCustomer(customerId) {
  return (await request("GET", PREFIX + "/customers/" + requireUuid(customerId, "customerId"))).data;
}

async function getCustomerIdForExternalId(externalId) {
  const id = String(externalId || "");
  if (!id || id.length > 50) throw new Error("externalId must be 1-50 characters");
  return (await request("GET", PREFIX + "/customers/external-id", {
    query: { externalId: id },
  })).data;
}

async function getServices({ description } = {}) {
  return (await request("GET", PREFIX + "/services", { query: { description } })).data;
}

async function getJobGroups({ description } = {}) {
  return (await request("GET", PREFIX + "/job-groups", { query: { description } })).data;
}

async function createCustomer(input) {
  assertWriteAllowed();
  return (await request("POST", PREFIX + "/customers", { body: input })).data;
}

async function addJobToCustomer(customerId, input) {
  assertWriteAllowed();
  return await request("POST", PREFIX + "/customers/" + requireUuid(customerId, "customerId") + "/jobs", {
    body: input,
  });
}

module.exports = {
  SqueegeeApiError,
  requireUuid,
  assertWriteAllowed,
  listCustomers,
  getCustomer,
  getCustomerIdForExternalId,
  getServices,
  getJobGroups,
  createCustomer,
  addJobToCustomer,
};
