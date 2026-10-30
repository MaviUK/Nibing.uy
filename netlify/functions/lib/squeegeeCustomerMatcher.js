"use strict";

/**
 * Pure customer matching rules for the Squeegee v3 CustomerPage response.
 * No network access, and no record creation. Compare postcode AND property,
 * then independently match contact details. Ambiguity blocks auto-creation.
 */
const { normalizedPostcode, externalCustomerReference } = require("./squeegeeBookingPlan");
const { requireUuid } = require("./squeegeeApiV3");

function stringValue(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    return String(value.text || value.addressDescription || value.formattedAddress || value.address || value.fullAddress || "");
  }
  return "";
}
function addressKey(value) {
  const text = stringValue(value).toUpperCase();
  const post = normalizedPostcode(text);
  if (!post) return "";
  const compactPost = post.replace(/\s/g, "");
  const localityStripped = text
    .replace(new RegExp(compactPost.slice(0,-3) + "\\s*" + compactPost.slice(-3) + "\\b", "g"), " ")
    .replace(/\bNORTHERN IRELAND\b/g, "")
    .replace(/\bUNITED KINGDOM\b/g, "")
    .replace(/\bRD\b/g, "ROAD")
    .replace(/\bST\b/g, "STREET")
    .replace(/\bAVE\b/g, "AVENUE")
    .replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  return compactPost + "|" + localityStripped;
}
function normalEmail(value) {
  return String(value || "").trim().toLowerCase();
}
function normalPhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("44")) digits = "0" + digits.slice(2);
  return digits;
}
function propertyNumber(value) {
  return stringValue(value).toUpperCase().match(/\b\d{1,4}[A-Z]?\b/)?.[0] || "";
}
function matchCustomers(booking, customerList) {
  if (!Array.isArray(customerList)) throw new TypeError("customerList must be an array");
  const postcode = normalizedPostcode(booking?.address);
  const wantedKey = addressKey(booking?.address);
  if (!postcode || !wantedKey) return { status: "needs_review", reason: "invalid_booking_address" };
  const externalRef = externalCustomerReference(booking);
  const wantedEmail = normalEmail(booking.email);
  const wantedPhone = normalPhone(booking.phone);
  const rows = customerList.filter(x=>x && typeof x==="object" && typeof x._id==="string");

  // External reference belongs to a customer identity, not a single job.
  const byRef = rows.filter(c=>String(c._externalId||"")===externalRef);
  if(byRef.length===1) {
    try { return {status:"matched",reason:"external_reference",customerId:requireUuid(byRef[0]._id,"customerId")}; }
    catch{ return {status:"needs_review",reason:"invalid_customer_id"}; }
  }
  if(byRef.length>1) return {status:"needs_review",reason:"duplicate_external_reference"};

  const sameProperty = rows.filter(c=>addressKey(c.address)===wantedKey);
  if(!sameProperty.length) {
    // An identical contact may legitimately buy a second property. Never
    // assign its jobs to the first property's Squeegee customer: the public
    // job-create input verified here does NOT configure an alternate address.
    // A different house number at the same postcode is a separate property.
    // Matching *house number* at the same postcode but a differently formatted
    // address can still be a duplicate; hold it for owner review.
    const wantedNumber=propertyNumber(booking.address);
    const nearDuplicate=rows.some(c =>
      normalizedPostcode(stringValue(c.address))===postcode &&
      (!wantedNumber || !propertyNumber(c.address) ||
       propertyNumber(c.address)===wantedNumber)
    );
    if(nearDuplicate)return {status:"needs_review",reason:"possible_existing_address"};
    return {status:"not_found"};
  }

  // More than one person can have an account at one address. Require exact
  // email or telephone match, and never match on name alone.
  const contactMatches = sameProperty.filter(c =>
    (wantedEmail && normalEmail(c.email)===wantedEmail) ||
    (wantedPhone && [c.phoneNumber,c.phoneNumberOther].some(v=>normalPhone(v)===wantedPhone))
  );
  if(contactMatches.length===1) {
    const match=contactMatches[0];
    const status=String(match.status || "").toLowerCase();
    if(["inactive","deleted","archived","cancelled","canceled"].includes(status)) {
      return {status:"needs_review",reason:"inactive_existing_customer"};
    }
    try { return {status:"matched",reason:"exact_property_and_contact",customerId:requireUuid(match._id,"customerId")}; }
    catch{ return {status:"needs_review",reason:"invalid_customer_id"}; }
  }
  return {status:"needs_review",reason:contactMatches.length>1?"multiple_contact_matches":"same_address_without_contact_match"};
}
// A first-page miss is NOT proof a customer is absent. Confirm all pages.
async function matchCustomersAcrossPages(booking, listPage, { maxPages = 40 } = {}) {
  if (typeof listPage !== "function") throw new TypeError("listPage must be a function");
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) {
    throw new RangeError("maxPages must be 1-100");
  }
  const targetPost = normalizedPostcode(booking?.address);
  const reference = externalCustomerReference(booking);
  const wantedEmail=normalEmail(booking?.email);
  const wantedPhone=normalPhone(booking?.phone);
  const found = new Map();
  let otherContactProperties=0;
  let pagedRequestId;

  for (let page = 1; page <= maxPages; page += 1) {
    const data = await listPage({ page, pagedRequestId });
    if (!data || typeof data !== "object" || !Array.isArray(data.customers) ||
        typeof data.hasMore !== "boolean") {
      return { status: "needs_review", reason: "unexpected_customers_page_shape" };
    }
    for (const row of data.customers) {
      if (typeof row?._id !== "string") continue;
      if (String(row._externalId || "") === reference ||
          normalizedPostcode(stringValue(row.address)) === targetPost) {
        found.set(row._id, row);
      } else {
        const sameEmail=wantedEmail && normalEmail(row.email)===wantedEmail;
        const samePhone=wantedPhone.length>=10 &&
          [row.phoneNumber,row.phoneNumberOther]
            .some(p=>normalPhone(p)===wantedPhone);
        if(sameEmail||samePhone)otherContactProperties++;
      }
    }
    if (!data.hasMore) {
      const candidates=[...found.values()];
      const result=matchCustomers(booking,candidates);
      const sameContactElsewhere=candidates.some(row=>
        addressKey(row.address)!==addressKey(booking?.address) &&
        ((wantedEmail && normalEmail(row.email)===wantedEmail) ||
         (wantedPhone.length>=10 &&
          [row.phoneNumber,row.phoneNumberOther].some(p=>normalPhone(p)===wantedPhone)))
      );
      // Do not expose contact IDs, emails or addresses in the status log.
      // The new property's Squeegee customer must retain its own address;
      // no existing account or billing method is changed.
      return {...result,pagesScanned:page,
        relatedContactAtDifferentAddress:
          result.status==="not_found" &&
          (otherContactProperties>0 || sameContactElsewhere),
      };
    }
    if (data.pagedRequestId) pagedRequestId = data.pagedRequestId;
  }
  // Scanning only part of the database must never cause a new customer write.
  return { status: "needs_review", reason: "customer_pagination_limit" };
}

module.exports={addressKey,normalEmail,normalPhone,matchCustomers,matchCustomersAcrossPages};
