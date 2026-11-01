"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const hq=require("../netlify/functions/lib/customerHQ");
const env={SQUEEGEE_API_KEY:"a".repeat(64)};
const NOW=Date.parse("2026-11-01T13:00:00Z");
const UUID="12345678-1234-4123-8123-123456789abc";
function store(){
  const rows=new Map();
  let seq=0;
  const next=()=>'"rev-'+(++seq)+'"';
  return {
    rows,
    async get(key){return rows.get(key)?.data||null;},
    async getWithMetadata(key){
      const item=rows.get(key);
      return item?{data:item.data,etag:item.etag}:null;
    },
    async setJSON(key,value,opts={}){
      const original=rows.get(key);
      if(opts.onlyIfNew===true && original)return {modified:false};
      if(opts.onlyIfMatch && original?.etag!==opts.onlyIfMatch)
        return {modified:false};
      if(opts.onlyIfMatch && !original)return {modified:false};
      const etag=next();
      rows.set(key,{data:value,etag});
      return {modified:true,etag};
    },
  };
}
const account={id:UUID,ref:"3027",email:"test@example.co.uk",
  firstName:"Alex",town:"Bangor",points:66,paidCleans:3,
  currentStreak:3,nextBonus:26,recordedSkips:0,
  events:[
    {date:"2026-01-01",event:"paid_completed_clean",points:20,streak:1},
    {date:"2026-01-29",event:"paid_completed_clean",points:22,streak:2},
    {date:"2026-02-26",event:"paid_completed_clean",points:24,streak:3},
  ]};
test("valid email is canonicalised; injected or malformed email cannot sign in",()=>{
  assert.equal(hq.normalizeEmail(" Test@Example.Co.Uk "),"test@example.co.uk");
  for(const invalid of ["","name","a@bad","foo@a.test\nBcc:other","a ".repeat(200)])
    assert.equal(hq.normalizeEmail(invalid),null);
});
test("email-only account linking must never guess between shared addresses",()=>{
  const single={version:1,accounts:[account]};
  assert.deepEqual(hq.accountForEmail(single,"test@example.co.uk"),account);
  assert.equal(hq.accountForEmail(single,"other@example.co.uk"),null);
  const shared={version:1,accounts:[account,{...account,id:"abcdefab-2222-4222-8222-abcdefabcdef"}]};
  assert.equal(hq.accountForEmail(shared,account.email),null);
});
test("a verified customer must match live active Squeegee id and email",()=>{
  const row={_id:UUID,status:"active",email:account.email};
  assert.equal(hq.validateApiCustomer(row,account),true);
  assert.equal(hq.validateApiCustomer({...row,status:"inactive"},account),false);
  assert.equal(hq.validateApiCustomer({...row,email:"wrong@example.co.uk"},account),false);
  assert.equal(hq.validateApiCustomer({...row,_id:"different"},account),false);
});
test("one-time codes use server HMAC, cannot be replayed or guessed",async()=>{
  const db=store();let mailedCode=null;
  const issued=await hq.issueCode({env,authStore:db,account,now:NOW,
    send:async(to,code)=>{assert.equal(to,account.email);mailedCode=code;}});
  assert.ok(issued.sent);
  assert.match(issued.challengeId,/^[a-f0-9]{32}$/);
  assert.match(mailedCode,/^\d{8}$/);
  const storeText=JSON.stringify([...db.rows.values()]);
  assert.ok(!storeText.includes(mailedCode));
  assert.ok(!storeText.includes(account.email));
  const denied=await hq.verifyCode({env,authStore:db,
    challengeId:issued.challengeId,code:"not-a-code",now:NOW+1000});
  assert.equal(denied,null);
  const accepted=await hq.verifyCode({env,authStore:db,
    challengeId:issued.challengeId,code:mailedCode,now:NOW+2000});
  assert.equal(accepted,UUID);
  assert.equal(await hq.verifyCode({env,authStore:db,
    challengeId:issued.challengeId,code:mailedCode,now:NOW+3000}),null);
  const second=await hq.issueCode({env,authStore:db,account,now:NOW+5000,
    send:async()=>{throw Error("second email should be throttled");}});
  assert.equal(second.sent,false);
});
test("wrong OTP attempts are bounded; expired OTP is refused",async()=>{
  const db=store();let code="";
  const first=await hq.issueCode({env,authStore:db,account,now:NOW,
    send:async(_,v)=>{code=v;}});
  const wrong=code==="00000000"?"99999999":"00000000";
  for(let n=0;n<5;n++){
    assert.equal(await hq.verifyCode({env,authStore:db,
      challengeId:first.challengeId,code:wrong,now:NOW+1000+n}),null);
  }
  assert.equal(await hq.verifyCode({env,authStore:db,
    challengeId:first.challengeId,code,now:NOW+9000}),null);
  assert.equal(await hq.verifyCode({env,authStore:db,
    challengeId:first.challengeId,code,now:NOW+hq.OTP_MS+1000}),null);
});
test("Customer HQ session is opaque, HttpOnly and revocable independently",async()=>{
  const db=store();
  const session=await hq.createSession({authStore:db,customerId:UUID,now:NOW});
  assert.match(session.token,/^[a-f0-9]{64}$/);
  assert.equal(await hq.readSession({authStore:db,token:session.token,now:NOW+1000}).then(s=>s.customerId),UUID);
  assert.equal(hq.cookieFromHeader("x=1; "+hq.setCookie(session.token,Date.now()+100000).split(";")[0]),session.token);
  assert.match(hq.setCookie(session.token,Date.now()+100000),/HttpOnly; SameSite=Lax/);
  assert.ok(!JSON.stringify([...db.rows.keys()]).includes(session.token));
  assert.equal(await hq.readSession({authStore:db,token:session.token,now:NOW+hq.SESSION_MS+1}),null);
  await hq.revokeSession({authStore:db,token:session.token});
  assert.equal(await hq.readSession({authStore:db,token:session.token,now:NOW+2000}),null);
});
test("a signed in account sees its own history but no private UUID, email or address",()=>{
  const pub=hq.publicAccount(account,550);
  assert.equal(pub.points,616);
  assert.equal(pub.cleaningPoints,66);
  assert.equal(pub.websiteXp,550);
  assert.equal(pub.nextBonus,26);
  assert.equal(pub.history.length,3);
  assert.equal(pub.history[0].points,24);
  const output=JSON.stringify(pub);
  assert.ok(!output.includes(UUID));
  assert.ok(!output.includes(account.email));
  assert.ok(!output.includes("address"));
});
test("invalid imported source fails closed instead of exposing mixed customer histories",()=>{
  assert.throws(()=>hq.validateSource(null),/invalid_hq_source/);
  assert.throws(()=>hq.validateSource({version:1,accounts:[]}),/invalid_hq_source/);
  assert.equal(hq.secret({}),null);
});
