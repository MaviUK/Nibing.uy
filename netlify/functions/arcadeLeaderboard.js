const {getStore}=require("@netlify/blobs");
const {verifyBooking,bookingPoints}=require("./lib/arcadeBookingProof");
const HEADERS={"Content-Type":"application/json","Cache-Control":"no-store","Access-Control-Allow-Origin":"*"};
const out=(code,data)=>({statusCode:code,headers:HEADERS,body:JSON.stringify(data)});
function stores(){return {public:getStore({name:"n64-preview-arcade-public",consistency:"strong"}),private:getStore({name:"n64-preview-arcade-private",consistency:"strong"})};}
async function entries(store){
  const all=[];let cursor;
  do{
    const page=await store.list({prefix:"player:",paginate:true,cursor});
    for(const blob of page.blobs||[]){const value=await store.get(blob.key,{type:"json"});if(value&&value.displayName)all.push(value);}
    cursor=page.cursor;
  }while(cursor&&all.length<500);
  return all.sort((a,b)=>b.points-a.points||a.createdAt.localeCompare(b.createdAt)).slice(0,100);
}
exports.handler=async(event)=>{
 if(!["GET","POST"].includes(event.httpMethod))return out(405,{error:"Method not allowed"});
 try{
  const s=stores();
  if(event.httpMethod==="GET"){const top=await entries(s.public);return out(200,{entries:top.map((x,i)=>({rank:i+1,name:x.displayName,points:x.points}))});}
  const body=JSON.parse(event.body||"{}");
  if(body.consent!==true)return out(400,{error:"Prize leaderboard consent required"});
  const b=verifyBooking(body.bookingProof);
  if(!b)return out(403,{error:"A completed verified booking is required"});
  const safeName=b.name.replace(/[<>]/g,"").trim();
  const claimed=Array.isArray(body.claimed)?body.claimed:[];
  const allowed=new Set(["l:what-we-do","l:the-process","l:bins-we-clean","l:why-clean-your-bin","l:why-ni-bin-guy","l:areas-we-cover","l:customer-portal","l:level-08-final"]);
  const unique=new Set(claimed.filter(x=>allowed.has(x)));
  const checkers=claimed.includes("a:coverage")?25:0;
  const binChecker=claimed.includes("a:bin-checker")?35:0;
  const xp=Math.min(100000,unique.size*50+checkers+binChecker+bookingPoints(b.bins));
  // Stable by email rather than name: prize contacts stay in the private store.
  const key=require("node:crypto").createHash("sha256").update(b.email.toLowerCase()).digest("hex");
  const existing=await s.public.get("player:"+key,{type:"json"});
  const previousContact=await s.private.get("player:"+key,{type:"json"});
  if(previousContact?.bookingId===b.id) return out(200,{success:true,points:existing?.points||xp,displayName:existing?.displayName||safeName,duplicate:true});
  const saved={displayName:safeName.slice(0,45),points:Math.max(xp,existing?.points||0),createdAt:existing?.createdAt||new Date().toISOString()};
  await s.private.setJSON("player:"+key,{name:b.name,email:b.email,phone:b.phone,address:b.address,bookingId:b.id,consentedAt:new Date().toISOString(),points:saved.points});
  await s.public.setJSON("player:"+key,saved);
  // A private notification lets the business owner contact a prize winner.
  // The public API never returns email, phone, address, or the booking token.
  if(process.env.RESEND_API_KEY){
    try {
      const {Resend}=require("resend");
      const resend=new Resend(process.env.RESEND_API_KEY);
      const message=await resend.emails.send({
        from:process.env.RESEND_FROM || "Ni Bin Guy <noreply@nibing.uy>",
        to:process.env.BOOKINGS_TO || "info@nibing.uy",
        subject:"NI Bin Guy arcade leaderboard - new prize entry",
        text:[
          "A customer opted into the global high-score and prize leaderboard.",
          "Name: "+b.name,"Email: "+b.email,"Phone: "+b.phone,
          "Address: "+b.address,"Booking reference: "+b.id,"XP: "+saved.points,
          "Consent: Public name and XP; private contact if prize won.",
          "Consent recorded: "+new Date().toISOString()
        ].join("\n")
      });
      if(message?.error) console.warn("Prize entry owner email not sent:",message.error);
    } catch(emailError){console.warn("Prize entry email unavailable:",emailError.message);}
  }
  return out(200,{success:true,points:saved.points,displayName:saved.displayName});
 }catch(e){console.error("Arcade leaderboard:",e);return out(503,{error:"Leaderboard temporarily unavailable"});}
};
