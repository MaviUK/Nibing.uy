"use strict";
const crypto=require("node:crypto");

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STORE="n64-preview1-squeegee-player-links";
const compact=value=>String(value||"").toLowerCase()
  .replace(/[.,\r\n]/g," ").replace(/\s+/g," ").trim();
const compactAddress=value=>compact(value).replace(/\s/g,"");
const emailKey=email=>crypto.createHash("sha256")
  .update(String(email||"").trim().toLowerCase()).digest("hex");

/**
 * Called exclusively AFTER the signed and idempotent Squeegee booking worker
 * commits the confirmed external jobs. No public client, email-only match or
 * inferred customer reference may call this function.
 */
async function linkAcceptedSqueegeeBooking({squeegeeId,booking},{
  publicStore,privateStore,linkStore
}={}){
  if(!UUID.test(String(squeegeeId||"")) || typeof booking!=="object" ||
     !booking || !booking.name || !booking.address ||
     !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(booking.email||"")))
    return {linked:false,reason:"invalid_verified_booking"};
  if(!publicStore||!privateStore||!linkStore)
    throw new Error("private_arcade_stores_unavailable");

  const key="player:"+emailKey(booking.email);
  const [privatePlayer,publicPlayer]=await Promise.all([
    privateStore.get(key,{type:"json"}),
    publicStore.get(key,{type:"json"}),
  ]);
  // The booking website previously saved players by email. Confirm the
  // exact person's NAME and SERVICE PROPERTY as well; many unrelated
  // properties can legitimately share a contact email or phone number.
  if(!privatePlayer || !(privatePlayer.enrolledAt||privatePlayer.consentedAt) ||
     !publicPlayer || !Number.isFinite(Number(publicPlayer.points)) ||
     compact(privatePlayer.name)!==compact(booking.name) ||
     compactAddress(privatePlayer.address)!==compactAddress(booking.address) ||
     String(privatePlayer.email||"").trim().toLowerCase()!==
       String(booking.email||"").trim().toLowerCase())
    return {linked:false,reason:"identity_unverified"};

  // Avoid assigning ALL email-keyed website XP to one property if that email
  // has already been used for multiple bookings/addresses.
  const bookingIds=Array.isArray(privatePlayer.bookingIds)?
    new Set(privatePlayer.bookingIds):new Set();
  if(bookingIds.size>1)
    return {linked:false,reason:"multiple_website_bookings_need_review"};

  const uuid=squeegeeId.toLowerCase();
  const old=await linkStore.get(key,{type:"json"});
  if(old){
    if(old.verified===true && old.squeegeeId===uuid)
      return {linked:true,unchanged:true};
    return {linked:false,reason:"existing_link_conflict"};
  }
  const written=await linkStore.setJSON(key,{
    squeegeeId:uuid,verified:true,
    verifiedAt:new Date().toISOString(),
    method:"confirmed_squeegee_job_and_matching_service_property",
  },{onlyIfNew:true});
  if(written?.modified!==true)return {linked:false,reason:"link_race_requires_review"};
  return {linked:true,unchanged:false};
}
module.exports={STORE,linkAcceptedSqueegeeBooking};
