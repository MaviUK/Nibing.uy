"use strict";

/**
 * Pure customer matching rules for the Squeegee v3 CustomerPage response.
 * No network access, and no record creation. Exact normalized address
 * AND full customer name is enough to identify an existing account even when
 * the submitted email/phone has changed. Existing contact/reference matching
 * remains supported; conflicts, duplicates and uncertain addresses hold.
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
function normalName(value) {
  return String(value || "").normalize("NFKC").toUpperCase()
    .replace(/\s+/g," ").trim();
}
function normalEmail(value) {
  return String(value || "").trim().toLowerCase();
}
const REACTIVATABLE_STATUSES=new Set(["inactive","deactivated"]);
const TERMINAL_STATUSES=new Set(["deleted","archived","cancelled","canceled"]);
function checkedCustomer(row,reason) {
  let customerId;
  try {customerId=requireUuid(row._id,"customerId");}
  catch {return {status:"needs_review",reason:"invalid_customer_id"};}
  const state=String(row.status||"").trim().toLowerCase();
  if(REACTIVATABLE_STATUSES.has(state)) {
    // Reuse identity, but no new job while actual account activation is
    // unavailable. Never turn an inactive account into a second customer.
    return {status:"reactivation_required",
      reason:"existing_customer_requires_reactivation",customerId,
      matchReason:reason};
  }
  if(TERMINAL_STATUSES.has(state))
    return {status:"needs_review",reason:"inactive_existing_customer"};
  return {status:"matched",reason,customerId};
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
  if(!Array.isArray(customerList))
    throw new TypeError("customerList must be an array");
  const postcode=normalizedPostcode(booking?.address);
  const wantedKey=addressKey(booking?.address);
  const wantedName=normalName(booking?.name);
  if(!postcode || !wantedKey)
    return {status:"needs_review",reason:"invalid_booking_address"};
  const externalRef=externalCustomerReference(booking);
  const wantedEmail=normalEmail(booking.email);
  const wantedPhone=normalPhone(booking.phone);
  const rows=customerList.filter(x=>x && typeof x==="object" &&
    typeof x._id==="string");

  const byRef=rows.filter(c=>String(c._externalId||"")===externalRef);
  if(byRef.length>1)
    return {status:"needs_review",reason:"duplicate_external_reference"};
  // Even a stable external ID may not override the actual saved property.
  if(byRef.length===1 && addressKey(byRef[0].address)!==wantedKey)
    return {status:"needs_review",reason:"external_reference_address_conflict"};

  const sameProperty=rows.filter(c=>addressKey(c.address)===wantedKey);
  if(!sameProperty.length) {
    // Different properties can legitimately share an email or name.
    // Incomplete address formatting with the same house+postcode is
    // uncertain, so don't create a second property/customer automatically.
    const wantedNumber=propertyNumber(booking.address);
    const nearDuplicate=rows.some(c=>
      normalizedPostcode(stringValue(c.address))===postcode &&
      (!wantedNumber || !propertyNumber(c.address) ||
       propertyNumber(c.address)===wantedNumber)
    );
    if(nearDuplicate)
      return {status:"needs_review",reason:"possible_existing_address"};
    return {status:"not_found"};
  }

  // The owner's new matching rule: identical full customer name + exact
  // normalized address identifies the account, regardless of changed email
  // or phone. A nonblank name is mandatory; never equate two empty names.
  const nameMatches=wantedName?sameProperty.filter(c=>
    normalName(c.name)===wantedName):[];
  const contactMatches=sameProperty.filter(c=>
    (wantedEmail && normalEmail(c.email)===wantedEmail) ||
    (wantedPhone.length>=10 && [c.phoneNumber,c.phoneNumberOther]
      .some(v=>normalPhone(v)===wantedPhone))
  );
  if(nameMatches.length>1)
    return {status:"needs_review",reason:"multiple_name_address_matches"};
  if(contactMatches.length>1)
    return {status:"needs_review",reason:"multiple_contact_matches"};
  if(nameMatches.length===1 && contactMatches.length===1 &&
     nameMatches[0]._id!==contactMatches[0]._id)
    return {status:"needs_review",reason:"conflicting_name_and_contact_matches"};
  // If a reference identifies a DIFFERENT row at the same property, hold.
  if(byRef.length===1 &&
     ((nameMatches.length===1 && nameMatches[0]._id!==byRef[0]._id) ||
      (contactMatches.length===1 && contactMatches[0]._id!==byRef[0]._id)))
    return {status:"needs_review",reason:"conflicting_customer_reference"};

  if(nameMatches.length===1)
    return checkedCustomer(nameMatches[0],"exact_property_and_name");
  if(contactMatches.length===1)
    return checkedCustomer(contactMatches[0],"exact_property_and_contact");
  if(byRef.length===1)
    return checkedCustomer(byRef[0],"external_reference");

  return {status:"needs_review",
    reason:"same_address_without_name_or_contact_match"};
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

module.exports={addressKey,normalName,normalEmail,normalPhone,
  matchCustomers,matchCustomersAcrossPages};
