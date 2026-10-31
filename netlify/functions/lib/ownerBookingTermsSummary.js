"use strict";
// The customer and owner receive the same type of signed Terms Acceptance
// Certificate PDF. Owner email body includes a concise confirmation only.
function escapeHtml(value) {
  return String(value??"").replace(/&/g,"&amp;")
    .replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function dateLabel(iso) {
  const parsed=Date.parse(String(iso||""));
  if(!Number.isFinite(parsed))return "Not available";
  return new Date(parsed).toLocaleString("en-GB",{
    timeZone:"Europe/London",day:"2-digit",month:"short",year:"numeric",
    hour:"2-digit",minute:"2-digit",
  });
}
function buildOwnerTermsSummary({
  termsAccepted,termsVersion,termsTimestamp,pdfAttached=false,
}={}) {
  const status=termsAccepted===true?"Accepted":"Not accepted";
  const version=String(termsVersion||"Not provided").slice(0,120);
  const confirmed=dateLabel(termsTimestamp);
  const pdfMessage=pdfAttached?
    "Terms & Conditions Acceptance Certificate PDF attached (customer copy).":
    "PDF not attached; see the recorded terms acceptance.";
  return {
    text:"Terms & Conditions: "+status+
      "\nVersion: "+version+
      "\nConfirmed: "+confirmed+
      "\n"+pdfMessage,
    html:
      '<p style="font-family:Arial,sans-serif;font-size:13px;line-height:1.55;color:#374151;margin:14px 0 0">'+
      '<strong>Terms &amp; Conditions:</strong> '+escapeHtml(status)+
      ' · '+escapeHtml(version)+
      ' · '+escapeHtml(confirmed)+
      '<br><strong>Certificate:</strong> '+escapeHtml(pdfMessage)+
      '</p>',
  };
}
// The customer PDF is staged before the worker starts, but its delivery is
// only known once the owner send is assembled. Reconcile the sentence to
// the ACTUAL outgoing attachment rather than trusting the customer receipt.
function withActualOwnerCertificateStatus(receipt,hasAttachment){
  if(!receipt || typeof receipt.text!=="string" ||
     typeof receipt.html!=="string")return receipt;
  const attached="Terms & Conditions Acceptance Certificate PDF attached (customer copy).";
  const missing="PDF not attached; see the recorded terms acceptance.";
  const unavailable="PDF not attached to this owner email; the customer's acceptance remains on record.";
  const replacement=hasAttachment?attached:unavailable;
  const htmlAttached=escapeHtml(attached);
  const htmlMissing=escapeHtml(missing);
  const htmlReplacement=escapeHtml(replacement);
  return {...receipt,
    text:receipt.text.replaceAll(attached,replacement).replaceAll(missing,replacement),
    html:receipt.html.replaceAll(htmlAttached,htmlReplacement)
      .replaceAll(htmlMissing,htmlReplacement),
  };
}
module.exports={buildOwnerTermsSummary,withActualOwnerCertificateStatus};
