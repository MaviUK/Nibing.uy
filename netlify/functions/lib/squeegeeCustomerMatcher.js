"use strict";

/**
 * Pure customer matching rules for the Squeegee v3 CustomerPage response.
 * No network access, and no record creation. Exact normalized address
 * AND full customer name is enough to identify an existing account even when
 * the submitted email/phone has changed. A different service property may
 * reuse the SAME customer only when full name, email AND phone all match.
 * Conflicts, duplicate identities and uncertain addresses hold for review.
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
  // Different properties under one person are not necessarily different
  // customers. Require ALL three independently supplied identity fields,
  // never just an email (which can be shared by landlords or families).
  const identityMatches=rows.filter(c=>wantedName && wantedEmail &&
    wantedPhone.length>=10 && normalName(c.name)===wantedName &&
    normalEmail(c.email)===wantedEmail &&
    [c.phoneNumber,c.phoneNumberOther].some(v=>normalPhone(v)===wantedPhone));
  if(identityMatches.length>1)
    return {status:"needs_review",reason:"multiple_exact_customer_identities"};

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
    if(identityMatches.length===1)
      return checkedCustomer(identityMatches[0],"exact_identity_other_property");
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
  // A previously duplicated Squeegee account at this property must not
  // silently supersede the original account with the same complete identity.
  if(identityMatches.length===1 && addressKey(identityMatches[0].address)!==wantedKey)
    return {status:"needs_review",reason:"conflicting_property_and_identity_accounts"};
  // If a reference identifies a DIFFERENT row at the same property, hold.
  if(byRef.length===1 &&
     ((nameMatches.length===1 && nameMatches[0]._id!==byRef[0]._id) ||
      (contactMatches.length===1 && contactMatches[0]._id!==byRef[0]._id)))
    return {status:"needs_review",reason:"conflicting_customer_reference"};

  if(byRef.length===1)
    return checkedCustomer(byRef[0],"external_reference");
  if(nameMatches.length===1)
    return checkedCustomer(nameMatches[0],"exact_property_and_name");
  if(contactMatches.length===1)
    return checkedCustomer(contactMatches[0],"exact_property_and_contact");

  return {status:"needs_review",
    reason:"same_address_without_name_or_contact_match"};
}
/**
 * Read-only duplicate signals, independent of the decision to reuse a
 * customer. Email addresses legitimately belong to multiple properties,
 * so these are INFORMATIONAL flags, never permission to merge accounts or
 * reject a normal booking. No PII or Squeegee IDs leave this function.
 */
const DUPLICATE_SIGNAL_CODES=Object.freeze([
  "email_already_registered",
  "email_used_at_other_property",
  "multiple_records_with_email",
  "address_already_registered",
  "address_registered_to_other_name",
  "multiple_records_at_address",
  "same_name_address_contact_changed",
  "possible_duplicate_address",
  "phone_already_registered",
  "phone_used_at_other_property",
]);
function detectDuplicateSignals(booking,customerRows) {
  const rows=Array.isArray(customerRows)?
    [...new Map(customerRows.filter(row=>typeof row?._id==="string")
      .map(row=>[row._id,row])).values()]:[];
  const wantedAddress=addressKey(booking?.address);
  const wantedPost=normalizedPostcode(booking?.address);
  const wantedHouse=propertyNumber(booking?.address);
  const wantedName=normalName(booking?.name);
  const wantedEmail=normalEmail(booking?.email);
  const wantedPhone=normalPhone(booking?.phone);
  const flags=new Set();
  const sameAddress=rows.filter(row=>wantedAddress &&
    addressKey(row.address)===wantedAddress);
  const sameEmail=rows.filter(row=>wantedEmail &&
    normalEmail(row.email)===wantedEmail);
  const samePhone=rows.filter(row=>wantedPhone.length>=10 &&
    [row.phoneNumber,row.phoneNumberOther]
      .some(phone=>normalPhone(phone)===wantedPhone));
  if(sameEmail.length)flags.add("email_already_registered");
  if(sameEmail.some(row=>addressKey(row.address)!==wantedAddress))
    flags.add("email_used_at_other_property");
  if(sameEmail.length>1)flags.add("multiple_records_with_email");
  if(sameAddress.length)flags.add("address_already_registered");
  if(sameAddress.some(row=>!wantedName ||
       normalName(row.name)!==wantedName))
    flags.add("address_registered_to_other_name");
  if(sameAddress.length>1)flags.add("multiple_records_at_address");
  if(sameAddress.some(row=>wantedName &&
     normalName(row.name)===wantedName &&
     !((wantedEmail && normalEmail(row.email)===wantedEmail) ||
       (wantedPhone.length>=10 &&
        [row.phoneNumber,row.phoneNumberOther]
          .some(phone=>normalPhone(phone)===wantedPhone)))))
    flags.add("same_name_address_contact_changed");
  if(wantedPost && wantedHouse &&
     rows.some(row=>normalizedPostcode(stringValue(row.address))===wantedPost &&
       propertyNumber(row.address)===wantedHouse &&
       addressKey(row.address)!==wantedAddress))
    flags.add("possible_duplicate_address");
  if(samePhone.length)flags.add("phone_already_registered");
  if(samePhone.some(row=>addressKey(row.address)!==wantedAddress))
    flags.add("phone_used_at_other_property");
  return DUPLICATE_SIGNAL_CODES.filter(code=>flags.has(code));
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
      const sameEmail=wantedEmail && normalEmail(row.email)===wantedEmail;
      const samePhone=wantedPhone.length>=10 &&
        [row.phoneNumber,row.phoneNumberOther]
          .some(p=>normalPhone(p)===wantedPhone);
      // Scan all pages for cross-property email/phone identity matches,
      // not just matches at the current service address. Only a unique
      // full name + email + phone match authorises cross-property reuse.
      if (String(row._externalId || "") === reference ||
          normalizedPostcode(stringValue(row.address)) === targetPost ||
          sameEmail || samePhone) {
        found.set(row._id,row);
      }
      if((sameEmail||samePhone) &&
         addressKey(row.address)!==addressKey(booking?.address))
        otherContactProperties++;
    }
    if (!data.hasMore) {
      const candidates=[...found.values()];
      const result=matchCustomers(booking,candidates);
      const duplicateFlags=detectDuplicateSignals(booking,candidates);
      const sameContactElsewhere=candidates.some(row=>
        addressKey(row.address)!==addressKey(booking?.address) &&
        ((wantedEmail && normalEmail(row.email)===wantedEmail) ||
         (wantedPhone.length>=10 &&
          [row.phoneNumber,row.phoneNumberOther].some(p=>normalPhone(p)===wantedPhone)))
      );
      // Do not expose contact IDs, emails or addresses in the status log.
      // A reused customer keeps its original address and billing details;
      // the new property must instead be set on the new job.
      return {...result,pagesScanned:page,duplicateFlags,
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
  DUPLICATE_SIGNAL_CODES,detectDuplicateSignals,
  matchCustomers,matchCustomersAcrossPages};
