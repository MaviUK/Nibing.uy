"use strict";
// Transfer the EXACT certificate PDF already sent to the customer across the
// signed Preview #77 Squeegee worker boundary. The 1.2 MB PDF is TOO LARGE
// for the signed event's 30 KB bound, so keep it in a private preview-only
// Netlify Blobs object keyed by the immutable booking reference.
const crypto=require("node:crypto");
const STORE="nibinguy-preview77-owner-certificates";
const ID_RE=/^NBG-(?:[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}|[A-Z0-9]+-[A-Z0-9]{8,12})$/i;
const SHA_RE=/^[a-f0-9]{64}$/;
const MAX_B64=4_000_000; // < 3 MB PDF, including large embedded logo.
function checkAttachment(attachment) {
  if(!attachment || typeof attachment!=="object" ||
     typeof attachment.filename!=="string" ||
     attachment.filename.length>160 ||
     !/^Ni-Bin-Guy-Terms-Acceptance-[A-Za-z0-9 _.-]+\.pdf$/.test(attachment.filename) ||
     attachment.contentType!=="application/pdf" ||
     typeof attachment.content!=="string" ||
     attachment.content.length<100 || attachment.content.length>MAX_B64 ||
     !/^[A-Za-z0-9+/]+={0,2}$/.test(attachment.content))
    throw new Error("invalid_owner_certificate_attachment");
  const bytes=Buffer.from(attachment.content,"base64");
  if(bytes.length<100 || bytes.length>3_000_000 ||
     bytes.subarray(0,5).toString("ascii")!=="%PDF-" ||
     bytes.toString("base64")!==attachment.content)
    throw new Error("invalid_owner_certificate_pdf");
  return {
    filename:attachment.filename,contentType:"application/pdf",
    content:attachment.content,
    sha256:crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}
async function storeCustomerCertificate(bookingId,attachment,store){
  if(!ID_RE.test(String(bookingId||"")) || !store?.setJSON)
    throw new Error("owner_certificate_storage_unavailable");
  const verified=checkAttachment(attachment);
  // No overwrites: a later accidental submission must never replace the
  // original certificate. Scope is Preview 77 only (in store name).
  const saved=await store.setJSON(bookingId,{
    bookingId,filename:verified.filename,contentType:verified.contentType,
    content:verified.content,sha256:verified.sha256,storedAt:Date.now(),
  },{onlyIfNew:true});
  if(saved?.modified!==true || !saved?.etag)
    throw new Error("owner_certificate_not_durably_stored");
  return {sha256:verified.sha256};
}
async function loadCustomerCertificate(bookingId,sha256,store){
  if(!ID_RE.test(String(bookingId||"")) ||
     !SHA_RE.test(String(sha256||"")) || !store?.get)
    throw new Error("owner_certificate_lookup_invalid");
  const saved=await store.get(bookingId,{type:"json",consistency:"strong"});
  if(!saved || saved.bookingId!==bookingId || saved.sha256!==sha256)
    throw new Error("owner_certificate_missing_or_mismatched");
  const verified=checkAttachment(saved);
  if(verified.sha256!==sha256)
    throw new Error("owner_certificate_integrity_failed");
  return {filename:verified.filename,content:verified.content,
    contentType:verified.contentType};
}
module.exports={STORE,storeCustomerCertificate,loadCustomerCertificate,
  checkAttachment};
