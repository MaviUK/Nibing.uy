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
module.exports={signBooking,verifyBooking,bookingPoints};
