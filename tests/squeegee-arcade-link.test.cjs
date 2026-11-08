"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const {linkAcceptedSqueegeeBooking}=require("../netlify/functions/lib/arcadeSqueegeeLink");

const uuid="12345678-1111-4111-8111-123456789abc";
const id=crypto.createHash("sha256").update("website@example.org").digest("hex");
const key="player:"+id;
const booking={name:"Alex Example",email:"website@example.org",
  address:"4 Market Street, Bangor, BT20 4AA"};
function setup({name=booking.name,address=booking.address,bookings=1}={}){
  const publicData=new Map([[key,{points:550,customerRef:"NBG-0102030405"}]]);
  const privateData=new Map([[key,{
    name,email:booking.email,address,enrolledAt:"2026-10-31T01:00:00Z",
    bookingIds:Array.from({length:bookings},(_,i)=>"NBG-BOOK"+i),
  }]]);
  const links=new Map();
  const store=m=>({
    get:async k=>m.get(k)||null,
    setJSON:async(k,value,{onlyIfNew}={})=>{
      if(onlyIfNew&&m.has(k))return {modified:false};
      m.set(k,value);return {modified:true,etag:'"abc"'};
    },
  });
  return {publicStore:store(publicData),privateStore:store(privateData),
    linkStore:store(links),links};
}
test("a confirmed job links website XP to Squeegee UUID without copying PII",async()=>{
  const deps=setup();
  const result=await linkAcceptedSqueegeeBooking({squeegeeId:uuid,booking},deps);
  assert.equal(result.linked,true);
  assert.equal(deps.links.get(key).squeegeeId,uuid);
  const value=JSON.stringify(deps.links.get(key));
  assert.ok(!value.includes("Market Street"));
  assert.ok(!value.includes("example.org"));
  assert.ok(!value.includes("Alex Example"));
  assert.deepEqual(await linkAcceptedSqueegeeBooking({squeegeeId:uuid,booking},deps),
    {linked:true,unchanged:true});
  assert.equal(deps.links.size,1);
});
test("wrong property or customer name never merges website points",async()=>{
  const mismatch=setup({address:"16 Main Road, Bangor, BT20 4AA"});
  const result=await linkAcceptedSqueegeeBooking({squeegeeId:uuid,booking},mismatch);
  assert.equal(result.linked,false);assert.equal(mismatch.links.size,0);
  const wrong=setup({name:"Different Customer"});
  assert.equal((await linkAcceptedSqueegeeBooking({squeegeeId:uuid,booking},wrong)).linked,false);
  assert.equal(wrong.links.size,0);
});
test("shared-email history and two different Squeegee accounts are held for review",async()=>{
  const several=setup({bookings:2});
  assert.equal((await linkAcceptedSqueegeeBooking({squeegeeId:uuid,booking},several)).linked,false);
  const deps=setup();
  await linkAcceptedSqueegeeBooking({squeegeeId:uuid,booking},deps);
  const other=await linkAcceptedSqueegeeBooking({
    squeegeeId:"abcdefab-2222-4222-8222-abcdefabcdef",booking
  },deps);
  assert.equal(other.reason,"existing_link_conflict");
  assert.equal(deps.links.get(key).squeegeeId,uuid);
});
