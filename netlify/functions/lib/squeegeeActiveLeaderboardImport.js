"use strict";
const crypto = require("node:crypto");
const { safePublicTown } = require("./arcadePublicIdentity");

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBLIC_REF_RE=/^NBG-[A-F0-9]{10}$/;
const BLOB_STORE="n64-preview1-squeegee-active-only";
const SNAPSHOT_KEY="active-accounts-v1";
const MAX_CSV_BYTES=250000;
const MAX_ACCOUNTS=5000;
const REQUIRED_COLUMNS=Object.freeze([
  "squeegee_customer_uuid_PRIVATE",
  "public_customer_reference",
  "town",
  "squeegee_state_PRIVATE",
  "deleted_in_backup_PRIVATE",
  "verified_paid_clean_points",
  "public_eligibility"
]);

function parseCsv(text) {
  if (typeof text!=="string" || Buffer.byteLength(text,"utf8")>MAX_CSV_BYTES ||
      text.includes("\0")) throw new Error("csv_invalid_size_or_content");
  const input=text.replace(/^\uFEFF/,"");
  const rows=[]; let row=[],field="",quoted=false;
  for(let i=0;i<input.length;i++){
    const ch=input[i];
    if(quoted){
      if(ch==='"' && input[i+1]==='"'){field+='"';i++;}
      else if(ch==='"')quoted=false;
      else field+=ch;
    }else if(ch==='"' && field===""){quoted=true;}
    else if(ch===","){row.push(field);field="";}
    else if(ch==="\r" || ch==="\n"){
      if(ch==="\r" && input[i+1]==="\n")i++;
      row.push(field);field="";
      if(!(row.length===1 && row[0]===""))rows.push(row);
      row=[];
      if(rows.length>MAX_ACCOUNTS+1)throw new Error("too_many_accounts");
    }else if(ch==='"')throw new Error("csv_invalid_quote");
    else field+=ch;
    if(field.length>12000)throw new Error("csv_field_too_long");
  }
  if(quoted)throw new Error("csv_unclosed_quote");
  row.push(field);
  if(!(row.length===1 && row[0]===""))rows.push(row);
  if(rows.length<2 || rows.length>MAX_ACCOUNTS+1)throw new Error("csv_empty_or_too_large");
  const columns=rows[0];
  if(new Set(columns).size!==columns.length ||
     REQUIRED_COLUMNS.some(name=>!columns.includes(name)))
    throw new Error("csv_missing_or_duplicate_columns");
  const ix=Object.fromEntries(columns.map((name,i)=>[name,i]));
  return rows.slice(1).map(cells=>{
    if(cells.length!==columns.length)throw new Error("csv_invalid_row");
    return Object.fromEntries(REQUIRED_COLUMNS.map(name=>[name,cells[ix[name]].trim()]));
  });
}
function canonicalLegacyRef(uuid) {
  if(typeof uuid!=="string" || !UUID_RE.test(uuid))return null;
  return "NBG-"+crypto.createHash("sha256")
    .update("nibinguy-legacy-squeegee-id-v1:"+uuid.toLowerCase())
    .digest("hex").slice(0,10).toUpperCase();
}
function isoDate(date) {
  return typeof date==="string" && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    new Date(date+"T00:00:00Z").toISOString().slice(0,10)===date;
}
function normalizeActiveImport(input,{asOf,now=Date.now()}={}) {
  if(!isoDate(asOf) || Date.parse(asOf+"T00:00:00Z")>now ||
     Date.parse(asOf+"T00:00:00Z")<Date.parse("2024-01-01T00:00:00Z"))
    throw new Error("invalid_source_date");
  const rows=parseCsv(input);
  const seenIds=new Set(),seenRefs=new Set();const accounts=[];
  let heldTown=0, zeroPoints=0, publishedCandidates=0, paidPoints=0;
  for(const row of rows){
    const id=row.squeegee_customer_uuid_PRIVATE.toLowerCase();
    const ref=row.public_customer_reference;
    const town=safePublicTown(row.town);
    const points=Number(row.verified_paid_clean_points);
    if(!UUID_RE.test(id) || !PUBLIC_REF_RE.test(ref) ||
       canonicalLegacyRef(id)!==ref ||
       !Number.isSafeInteger(points) || points<0 || points>100000 ||
       row.squeegee_state_PRIVATE.toLowerCase()!=="active" ||
       row.deleted_in_backup_PRIVATE!=="0")
      throw new Error("inactive_or_invalid_account_row");
    if(seenIds.has(id)||seenRefs.has(ref))throw new Error("duplicate_account");
    seenIds.add(id);seenRefs.add(ref);
    const eligibility=points===0?"no_verified_paid_history":
      town==="Town unavailable"?"needs_town_review":"eligible_pending_notice_and_consent";
    if(row.public_eligibility!==eligibility)
      throw new Error("inconsistent_eligibility");
    if(points===0)zeroPoints++;
    else if(town==="Town unavailable")heldTown++;
    else {publishedCandidates++;paidPoints+=points;}
    accounts.push({id,ref,town,paidCleans:points,active:true});
  }
  accounts.sort((a,b)=>a.id.localeCompare(b.id));
  return {
    version:1,asOf,importedAt:new Date(now).toISOString(),published:false,
    sourceHash:crypto.createHash("sha256").update(input).digest("hex"),
    summary:{
      activeAccounts:accounts.length,publishedCandidates,heldTown,zeroPoints,
      historicalPaidPoints:paidPoints
    },
    accounts
  };
}
function eligibleHistoricalEntries(snapshot) {
  if(snapshot?.version!==1 || !Array.isArray(snapshot?.accounts) ||
     !isoDate(snapshot.asOf))return [];
  const candidates=[];
  const refs=new Set();
  for(const row of snapshot.accounts){
    if(!row || row.active!==true || !UUID_RE.test(String(row.id||"")) ||
       canonicalLegacyRef(row.id)!==row.ref ||
       !Number.isSafeInteger(row.paidCleans) || row.paidCleans<=0 ||
       row.paidCleans>100000 || safePublicTown(row.town)!==row.town ||
       row.town==="Town unavailable" || refs.has(row.ref))continue;
    refs.add(row.ref);
    candidates.push({
      squeegeeId:row.id,customerRef:row.ref,town:row.town,
      paidCleans:row.paidCleans
    });
  }
  return candidates;
}
function combinedPublicBoard(snapshot,websiteScores=new Map()) {
  const rows=eligibleHistoricalEntries(snapshot).map(row=>{
    const websitePoints=websiteScores instanceof Map?
      Number(websiteScores.get(row.squeegeeId)||0):0;
    const safeXP=Number.isSafeInteger(websitePoints) && websitePoints>=0 ?
      Math.min(100000,websitePoints):0;
    return {
      customerRef:row.customerRef,town:row.town,
      points:Math.min(100000,row.paidCleans+safeXP),
    };
  }).sort((a,b)=>b.points-a.points ||
    a.customerRef.localeCompare(b.customerRef));
  return {
    entries:rows.slice(0,10).map((r,i)=>({rank:i+1,...r})),
    totalPlayers:rows.length,
    sourceAsOf:snapshot?.asOf||null,
    lastUpdatedAt:snapshot?.importedAt||null,
  };
}
function snapshotIsFresh(snapshot,now=Date.now(),maxAgeDays=7) {
  if(!isoDate(snapshot?.asOf))return false;
  const age=now-Date.parse(snapshot.asOf+"T23:59:59.999Z");
  return Number.isFinite(age) && age>=-86400000 && age<=maxAgeDays*86400000;
}
module.exports={
  BLOB_STORE,SNAPSHOT_KEY,MAX_CSV_BYTES,
  parseCsv,canonicalLegacyRef,normalizeActiveImport,
  eligibleHistoricalEntries,combinedPublicBoard,snapshotIsFresh
};
