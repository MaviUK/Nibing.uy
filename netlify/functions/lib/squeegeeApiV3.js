"use strict";

/**
 * NI Bin Guy -> Squeegee API v3 (documented public endpoints only).
 * Source: https://api02.sqgee.com/api/v3/docs (reviewed 2026-10-30).
 *
 * This module is never imported by browser code. No Squeegee writes are
 * permitted until owner approval AND a durable idempotency ledger are ready.
 */
const { AsyncLocalStorage } = require("node:async_hooks");
const previewTestContext = new AsyncLocalStorage();
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

function isExactPreview1(env = process.env) {
  return env.CONTEXT === "deploy-preview" &&
    env.REVIEW_ID === "77" &&
    env.BRANCH === "preview/n64-retro-site" &&
    env.DEPLOY_PRIME_URL === "https://deploy-preview-77--nibinguy.netlify.app";
}
function assertWriteAllowed() {
  // Both routes are PREVIEW 1 ONLY. Production and Preview 2 are excluded.
  // Default writes require all existing owner-enabled flags.
  // A single owner-authorized test can instead run in its own async context;
  // the context is created ONLY after a verified one-time reservation.
  const normal = isExactPreview1() &&
    process.env.SQUEEGEE_WRITE_ENABLED === "true" &&
    process.env.SQUEEGEE_OWNER_APPROVED_WRITES === "true" &&
    process.env.SQUEEGEE_ATOMIC_LEDGER_READY === "true";
  const singleTest = isExactPreview1() &&
    previewTestContext.getStore()?.singleApprovedTest === true;
  if (!normal && !singleTest) throw new Error("Squeegee writes are disabled for this deployment");
}
async function withOneApprovedPreviewTestWrite(proof, operation) {
  // Do NOT accept this proof from the request body or a browser header.
  // The orchestration code obtains it from a successful atomic Blob claim.
  if (!isExactPreview1() ||
      proof?.acquired !== true ||
      !String(proof.key || "").startsWith("claim-v1/approved-preview-1/") ||
      typeof proof.etag !== "string" || proof.etag.length < 4 ||
      typeof operation !== "function") {
    throw new Error("Owner-approved single-test write capability unavailable");
  }
  return await previewTestContext.run({ singleApprovedTest:true }, operation);
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
  isExactPreview1,
  withOneApprovedPreviewTestWrite,
  listCustomers,
  getCustomer,
  getCustomerIdForExternalId,
  getServices,
  getJobGroups,
  createCustomer,
  addJobToCustomer,
};
