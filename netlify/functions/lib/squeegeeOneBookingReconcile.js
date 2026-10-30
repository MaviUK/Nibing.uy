"use strict";

/**
 * Owner-only, read-only reconciliation for the single accepted booking
 * of 30 October 2026 (15:28 UTC). No POST or customer data is returned.
 *
 * This does not authorise another booking or consume/release any claim.
 * The immutable one-shot writer remains separately gated.
 */
const { matchCustomersAcrossPages } = require("./squeegeeCustomerMatcher");

const BOOKING_RE=/^NBG-[A-Z0-9]+-[A-Z0-9]{8,12}$/i;
// The specific already-confirmed form submission, not a general-purpose
// archive or customer-search endpoint. Do not scan all historic bookings.
const AUDIT_PREFIXES=Object.freeze([
  "2026-10-30T15:28",
  "2026-10-30T15:29",
]);
const MAX_AUDIT_ROWS=120;

async function findAcceptedAudit(bookingId,auditStore) {
  if(!BOOKING_RE.test(String(bookingId||""))) {
    return {status:"invalid_reference"};
  }
  if(!auditStore || typeof auditStore.list!=="function" ||
      typeof auditStore.get!=="function") {
    return {status:"audit_unavailable"};
  }
  try {
    const matches=[];
    let inspected=0;
    for(const prefix of AUDIT_PREFIXES) {
      const listed=await auditStore.list({prefix});
      if(!Array.isArray(listed?.blobs))return {status:"audit_unavailable"};
      for(const item of listed.blobs) {
        if(typeof item?.key!=="string" || !item.key.startsWith(prefix))continue;
        inspected++;
        if(inspected>MAX_AUDIT_ROWS)return {status:"audit_limit_reached"};
        const row=await auditStore.get(item.key,{type:"json",consistency:"strong"});
        if(row?.bookingId===bookingId)matches.push(row);
      }
    }
    if(matches.length===0)return {status:"not_found"};
    if(matches.length!==1)return {status:"multiple_records"};
    const row=matches[0];
    if(row.channel!=="email" || row.termsAccepted!==true ||
       !String(row.name||"").trim() || !String(row.email||"").trim() ||
       !String(row.address||"").trim() ||
       !Array.isArray(row.bins) || row.bins.length!==1 ||
       row.bins[0]?.planId!=="domestic_4w" ||
       Number(row.bins[0]?.count)!==1) {
      return {status:"not_eligible_test_audit"};
    }
    return {status:"found",record:row};
  } catch {
    return {status:"audit_unavailable"};
  }
}

/**
 * Performs read-only GETs only when the original accepted audit exists.
 * Dependencies are injected by the owner-authenticated modern Function.
 * All results deliberately exclude email, address, customer name and IDs.
 */
async function reconcileAcceptedBooking(bookingId, {
  auditStore,listCustomers,getCustomer,
}={}) {
  const audit=await findAcceptedAudit(bookingId,auditStore);
  if(audit.status!=="found") {
    return {audit:audit.status,customer:"not_checked"};
  }
  if(typeof listCustomers!=="function" || typeof getCustomer!=="function") {
    return {audit:"found",customer:"read_unavailable"};
  }
  let result;
  try {
    result=await matchCustomersAcrossPages(audit.record,params=>listCustomers(params),{
      maxPages:40,
    });
  } catch {
    return {audit:"found",customer:"read_unavailable"};
  }
  if(result?.status==="not_found") {
    return {audit:"found",customer:"not_found",
      pagesScanned:result.pagesScanned||null};
  }
  if(result?.status!=="matched" || !result.customerId) {
    return {audit:"found",customer:"requires_review"};
  }
  try {
    const customer=await getCustomer(result.customerId);
    if(!customer || typeof customer!=="object") {
      return {audit:"found",customer:"read_unavailable"};
    }
    const testLabel=String(customer.name||"").startsWith("TEST API - ");
    const jobs=Array.isArray(customer.jobs)?customer.jobs:null;
    return {
      audit:"found",
      customer:testLabel?"test_customer_found":"existing_customer_found",
      jobCount:jobs?jobs.length:null,
      pagesScanned:result.pagesScanned||null,
      // Appointment dates/recurrence are NOT exposed in public Squeegee GET.
      scheduleRequiresManualReview:true,
    };
  } catch {
    return {audit:"found",customer:"read_unavailable"};
  }
}

module.exports={ AUDIT_PREFIXES, findAcceptedAudit,reconcileAcceptedBooking };
