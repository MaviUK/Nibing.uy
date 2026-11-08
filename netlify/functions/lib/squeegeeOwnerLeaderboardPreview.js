"use strict";

// Only call this from an OWNER-SESSION-PROTECTED handler. Private Customer HQ
// history contains unconsented first names and Squeegee account references.
// Never expose these rows in the public /arcadeLeaderboard response.
const {canonicalLegacyRef}=require("./squeegeeActiveLeaderboardImport");
const {safeFirstName}=require("./squeegeeLeaderboardNameConsent");
const binHistory=require("./squeegeePreviewBinHistory");
const overdue=require("./squeegeeOverduePenalty");

function ownerPrivateLeaderboardPreview(privateSnapshot,consentSnapshot,eligible,limit=20) {
  if(!privateSnapshot || !Array.isArray(privateSnapshot.accounts) ||
     !eligible || !(eligible.aliases instanceof Set) ||
     !Number.isSafeInteger(limit) || limit<1 || limit>5000 ||
     (limit>941&&!binHistory.isBinSnapshot(privateSnapshot)))return null;

  const status=new Map(
    (Array.isArray(consentSnapshot?.records)?consentSnapshot.records:[])
      .map(r=>[r.alias,r]));
  const all=privateSnapshot.accounts
    .filter(r=>r?.id && eligible.aliases.has(canonicalLegacyRef(r.id)))
    .map(r=>{
      const alias=canonicalLegacyRef(r.id);
      const permission=status.get(alias);
      const approved=permission?.consent==="granted" &&
        !permission.withdrawnAt &&
        permission.noticeVersion==="nibinguy-leaderboard-firstname-town-xp-v1" &&
        permission.consentAt && permission.method && permission.evidenceRef &&
        permission.town===r.town && safeFirstName(permission.firstName);
      return {
        customerReference:String(r.ref||""),
        firstName:approved?permission.firstName:(safeFirstName(r.firstName)||null),
        town:String(r.town||"Town unavailable"),
        points:Math.max(0,r.points-overdue.penaltyTotal(r.penaltyLedger)),
        verification:"verified_from_squeegee_backup",
        permission:approved?"approved":permission?.consent==="withdrawn"?"withdrawn":"pending",
      };
    })
    .filter(r=>Number.isSafeInteger(r.points) && r.points>=0 &&
      typeof r.customerReference==="string")
    .sort((a,b)=>b.points-a.points ||
      a.customerReference.localeCompare(b.customerReference));
  return {
    count:all.length,
    cleaningXp:eligible.historicalPoints,
    verified:all.length,
    verifiedAsOf:privateSnapshot.asOf,
    approved:all.filter(r=>r.permission==="approved").length,
    rows:all.slice(0,limit).map((r,i)=>({rank:i+1,...r})),
  };
}
module.exports={ownerPrivateLeaderboardPreview};
