"use strict";
const crypto = require("node:crypto");
const { safePublicTown } = require("./arcadePublicIdentity");
const { RULE_VERSION } = require("./squeegeeCleaningStreak");

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBLIC_REF_RE=/^NBG-[A-F0-9]{10}$/;
const BLOB_STORE="n64-preview1-squeegee-active-only";
const SNAPSHOT_KEY="active-accounts-v1";
const PUBLISHED_KEY="published-active-accounts-v1";
const MODE_KEY="active-only-mode-v1";
const MAX_CSV_BYTES=250000;
const MAX_ACCOUNTS=5000;
const STREAK_COLUMNS=Object.freeze([
  "streak_points", "current_consecutive_clean_visits",
  "next_completed_visit_bonus", "recorded_skipped_visits",
  "max_consecutive_clean_visits", "scoring_version"
]);
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
  const streakColumnsFound=STREAK_COLUMNS.filter(name=>columns.includes(name));
  if(streakColumnsFound.length && streakColumnsFound.length!==STREAK_COLUMNS.length)
    throw new Error("incomplete_streak_scoring_columns");
  const ix=Object.fromEntries(columns.map((name,i)=>[name,i]));
  const requested=streakColumnsFound.length ? [...REQUIRED_COLUMNS,...STREAK_COLUMNS] : REQUIRED_COLUMNS;
  return rows.slice(1).map(cells=>{
    if(cells.length!==columns.length)throw new Error("csv_invalid_row");
    return Object.fromEntries(requested.map(name=>[name,cells[ix[name]].trim()]));
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
  const version=rows.every(row => row.scoring_version===RULE_VERSION) ? 2 : 1;
  if(rows.some(row=>Object.hasOwn(row,"streak_points")) && version!==2)
    throw new Error("streak_scoring_version_invalid");
  let heldTown=0, zeroPoints=0, publishedCandidates=0, paidPoints=0, paidCleanCount=0;
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
    let streakPoints=points;
    let currentStreak=0, recordedSkippedVisits=0;
    if(version===2){
      streakPoints=Number(row.streak_points);
      currentStreak=Number(row.current_consecutive_clean_visits);
      const nextPoints=Number(row.next_completed_visit_bonus);
      const longest=Number(row.max_consecutive_clean_visits);
      recordedSkippedVisits=Number(row.recorded_skipped_visits);
      if(!Number.isSafeInteger(streakPoints) || streakPoints<points*20 ||
         streakPoints>100000 || (points===0&&streakPoints!==0) ||
         !Number.isSafeInteger(currentStreak) || currentStreak<0 ||
         !Number.isSafeInteger(nextPoints) || nextPoints!==20+currentStreak*2 ||
         !Number.isSafeInteger(recordedSkippedVisits) || recordedSkippedVisits<0 ||
         !Number.isSafeInteger(longest) || longest<currentStreak || longest>10000)
        throw new Error("invalid_streak_scoring_values");
    }
    if(seenIds.has(id)||seenRefs.has(ref))throw new Error("duplicate_account");
    seenIds.add(id);seenRefs.add(ref);
    const eligibility=points===0?"no_verified_paid_history":
      town==="Town unavailable"?"needs_town_review":"eligible_pending_notice_and_consent";
    if(row.public_eligibility!==eligibility)
      throw new Error("inconsistent_eligibility");
    if(points===0)zeroPoints++;
    else if(town==="Town unavailable")heldTown++;
    else {publishedCandidates++;paidPoints+=streakPoints;paidCleanCount+=points;}
    accounts.push({id,ref,town,paidCleans:points,historicalPoints:streakPoints,
      currentStreak,recordedSkippedVisits,active:true});
  }
  accounts.sort((a,b)=>a.id.localeCompare(b.id));
  return {
    version,scoringVersion:version===2?RULE_VERSION:"legacy-one-point-per-clean",
    asOf,importedAt:new Date(now).toISOString(),published:false,
    sourceHash:crypto.createHash("sha256").update(input).digest("hex"),
    summary:{
      activeAccounts:accounts.length,publishedCandidates,heldTown,zeroPoints,
      historicalPaidPoints:paidPoints,
      ...(version===2?{paidCleanCount}:{})
    },
    accounts
  };
}
function eligibleHistoricalEntries(snapshot) {
  if(![1,2].includes(snapshot?.version) || !Array.isArray(snapshot?.accounts) ||
     !isoDate(snapshot.asOf))return [];
  if(snapshot.version===2 && snapshot.scoringVersion!==RULE_VERSION)return [];
  const candidates=[];
  const refs=new Set();
  for(const row of snapshot.accounts){
    if(!row || row.active!==true || !UUID_RE.test(String(row.id||"")) ||
       canonicalLegacyRef(row.id)!==row.ref ||
       !Number.isSafeInteger(row.paidCleans) || row.paidCleans<=0 ||
       row.paidCleans>100000 ||
       !Number.isSafeInteger(row.historicalPoints) ||
       row.historicalPoints<row.paidCleans || row.historicalPoints>100000 ||
       safePublicTown(row.town)!==row.town ||
       row.town==="Town unavailable" || refs.has(row.ref))continue;
    refs.add(row.ref);
    candidates.push({
      squeegeeId:row.id,customerRef:row.ref,town:row.town,
      paidCleans:row.paidCleans,historicalPoints:row.historicalPoints
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
      points:Math.min(100000,row.historicalPoints+safeXP),
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
  BLOB_STORE,SNAPSHOT_KEY,PUBLISHED_KEY,MODE_KEY,MAX_CSV_BYTES,
  parseCsv,canonicalLegacyRef,normalizeActiveImport,
  eligibleHistoricalEntries,combinedPublicBoard,snapshotIsFresh
};
