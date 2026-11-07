const crypto = require("node:crypto");
const SECRET = process.env.N64_PREVIEW_LEADERBOARD_SECRET || "";
function signBooking(payload) {
  if (!SECRET || !payload?.name || !payload?.email) return null;
  const data = {
    id: String(payload.bookingId || crypto.randomUUID()).slice(0,100),
    name: String(payload.name).trim().slice(0,90),
    email: String(payload.email).trim().slice(0,180),
    phone: String(payload.phone || "").slice(0,60),
    address: String(payload.address || "").slice(0,300),
    bins: (Array.isArray(payload.bins) ? payload.bins : []).slice(0,30).map(b=>({
      type:String(b.type || "").slice(0,60),count:Math.max(0,Math.min(100,Math.floor(Number(b.count)||0))),
      planId:String(b.planId||"").slice(0,60)
    })),
    exp:Date.now()+24*60*60*1000
  };
  const b64=Buffer.from(JSON.stringify(data)).toString("base64url");
  const sig=crypto.createHmac("sha256",SECRET).update(b64).digest("base64url");
  return b64+"."+sig;
}
function verifyBooking(token) {
  if(!SECRET || typeof token!=="string"||token.length>6500)return null;
  const pieces=token.split(".");if(pieces.length!==2)return null;
  const wanted=crypto.createHmac("sha256",SECRET).update(pieces[0]).digest();
  let provided;try{provided=Buffer.from(pieces[1],"base64url");}catch{return null;}
  if(provided.length!==wanted.length||!crypto.timingSafeEqual(provided,wanted))return null;
  try{const data=JSON.parse(Buffer.from(pieces[0],"base64url").toString());return data.exp>Date.now()&&data.name&&data.email?data:null;}catch{return null;}
}
function bookingPoints(bins){return (bins||[]).reduce((a,b)=>a+(String(b.planId).endsWith("_4w")?150:String(b.planId).endsWith("_oneoff")?60:0)*b.count,0);}

// A separate, pseudonymous proof for updating an opted-in player's XP.
// The browser cookie contains no name, address, email, phone or booking data.
// It is not a payment credential or a proof that a level was truly played.
function signPlayerSession(emailKey) {
  if (!SECRET || !/^[a-f0-9]{64}$/.test(String(emailKey))) return null;
  const payload = {
    scope: "n64-player-xp",
    key: emailKey,
    exp: Date.now() + 90 * 24 * 60 * 60 * 1000
  };
  const text = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", SECRET)
    .update("player:" + text).digest("base64url");
  return text + "." + signature;
}
function verifyPlayerSession(token) {
  if (!SECRET || typeof token !== "string" || token.length > 700) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const signature = crypto.createHmac("sha256", SECRET)
    .update("player:" + parts[0]).digest();
  let supplied;
  try { supplied = Buffer.from(parts[1], "base64url"); } catch { return null; }
  if (supplied.length !== signature.length || !crypto.timingSafeEqual(signature, supplied)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    return payload.scope === "n64-player-xp" &&
      /^[a-f0-9]{64}$/.test(payload.key) &&
      Number.isFinite(payload.exp) && payload.exp > Date.now()
      ? payload.key : null;
  } catch { return null; }
}
module.exports={signBooking,verifyBooking,bookingPoints,signPlayerSession,verifyPlayerSession};
