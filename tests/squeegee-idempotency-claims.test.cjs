"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {customerKey,jobKey,additionalBinKey,additionalJobKey,claimOnce,changeClaimState}=
  require("../netlify/functions/lib/squeegeeIdempotencyClaims");

function makeStore(){
  const records=new Map();
  let sequence=0;
  return {
    async setJSON(key,record,{onlyIfNew,onlyIfMatch}={}){
      const old=records.get(key);
      if(onlyIfNew && old) return {modified:false};
      if(onlyIfMatch && (!old || old.etag!==onlyIfMatch)) return {modified:false};
      const etag='"etag-'+(++sequence)+'"';
      records.set(key,{record,etag});
      return {modified:true,etag};
    },
    read(key){return records.get(key);},
  };
}
const booking=(bookingId="NBG-ABCDE-ABCDEFGH")=>({
  bookingId,
  email:"example@example.org",
  address:"17 Example Street, Bangor BT20 4AA",
});
const job={
  type:"Black Bin",planId:"domestic_4w",date:"2026-11-02",count:2,
};

test("different submitted booking IDs for same customer/date/bin share a single claim",async()=>{
  const store=makeStore();
  const first=booking();
  const second=booking("NBG-FGHIJ-HIJKLMNO");
  const k1=jobKey(first,job);
  const k2=jobKey(second,{...job,count:3});
  assert.equal(k1,k2);
  assert.equal(k1.includes("example.org"),false);
  assert.equal(k1.includes("BT20"),false);
  const [a,b]=await Promise.all([
    claimOnce({key:k1,bookingId:first.bookingId,channel:"email",store}),
    claimOnce({key:k2,bookingId:second.bookingId,channel:"whatsapp",store}),
  ]);
  assert.equal([a.acquired,b.acquired].filter(Boolean).length,1);
  assert.equal(store.read(k1).record.state,"reserved");
});

test("inflight state can be advanced only with the current ETag",async()=>{
  const store=makeStore();
  const b=booking();
  const key=jobKey(b,job);
  const reserved=await claimOnce({key,bookingId:b.bookingId,store});
  assert.equal(reserved.acquired,true);
  const inProgress=await changeClaimState({
    key,bookingId:b.bookingId,etag:reserved.etag,
    state:"request_in_progress",store,
  });
  assert.equal(inProgress.changed,true);
  const oldVersion=await changeClaimState({
    key,bookingId:b.bookingId,etag:reserved.etag,
    state:"succeeded",store,
  });
  assert.equal(oldVersion.changed,false);
  const succeeded=await changeClaimState({
    key,bookingId:b.bookingId,etag:inProgress.etag,
    state:"succeeded",store,
  });
  assert.equal(succeeded.changed,true);
});

test("unknown Squeegee POST results remain claimed and require human reconciliation",async()=>{
  const store=makeStore(),b=booking();
  const key=jobKey(b,job);
  const claim=await claimOnce({key,bookingId:b.bookingId,store});
  const inflight=await changeClaimState({key,bookingId:b.bookingId,etag:claim.etag,state:"request_in_progress",store});
  await changeClaimState({key,bookingId:b.bookingId,etag:inflight.etag,state:"requires_reconciliation",store});
  const second=await claimOnce({key,bookingId:booking("NBG-KLMNO-PQRSTUVW").bookingId,store});
  assert.equal(second.acquired,false);
  assert.equal(store.read(key).record.state,"requires_reconciliation");
});

test("a changed bin date has a different claim, for the next four-weekly visit",()=>{
  assert.notEqual(jobKey(booking(),job),jobKey(booking(),{...job,date:"2026-11-30"}));
});

test("blank ETag is an uncertain write and must never enable a Squeegee POST",async()=>{
  const store={
    async setJSON(){ return {modified:true,etag:""}; },
  };
  const b=booking(),key=jobKey(b,job);
  const claim=await claimOnce({key,bookingId:b.bookingId,store});
  assert.equal(claim.acquired,false);
  assert.equal(claim.reason,"already_claimed_or_uncertain");
});

test("a failed blob write blocks the Squeegee write",async()=>{
  const store={ async setJSON(){throw new Error("storage unavailable");} };
  const b=booking(),key=jobKey(b,job);
  const claim=await claimOnce({key,bookingId:b.bookingId,store});
  assert.equal(claim.acquired,false);
  const change=await changeClaimState({key,bookingId:b.bookingId,etag:'"x"',state:"request_in_progress",store});
  assert.equal(change.changed,false);
});

test("customer claims are stable and hide PII",()=>{
  const x=customerKey(booking());
  assert.equal(x,customerKey({...booking(),email:"EXAMPLE@EXAMPLE.ORG"}));
  assert.equal(x.includes("example"),false);
  assert.equal(x.includes("BT20"),false);
});


test("different emails at the same property claim one customer/job only", async()=>{
  const store=makeStore();
  const first=booking();
  const second={...booking("NBG-JKLMN-ABCDEFGH"), email:"other@example.net"};
  assert.equal(customerKey(first),customerKey(second));
  const firstKey=jobKey(first,job);
  assert.equal(firstKey,jobKey(second,job));
  const records=await Promise.all([
    claimOnce({key:firstKey,bookingId:first.bookingId,store,channel:"email"}),
    claimOnce({key:jobKey(second,job),bookingId:second.bookingId,store,channel:"whatsapp"}),
  ]);
  assert.equal(records.filter(r=>r.acquired).length,1);
});
test("street abbreviations and postcode spacing preserve the same claim",()=>{
  const a={address:"17 Example Rd, Bangor BT20 4AA"};
  const b={address:"17 Example Road, Bangor, BT204AA"};
  assert.equal(customerKey(a),customerKey(b));
});
test("two different properties sharing a postcode never share a customer claim",()=>{
  const a={address:"17 Example Road, Bangor, BT20 4AA"};
  const b={address:"19 Example Road, Bangor, BT20 4AA"};
  assert.notEqual(customerKey(a),customerKey(b));
});

test("additional purchases have booking-specific claims that never clear original active-bin reservations",async()=>{
  const a=booking("NBG-ABCDE-ABCDEFGH"),b=booking("NBG-FGHIJ-HIJKLMNO");
  const bin={type:"Brown Bin",planId:"domestic_4w",count:1};
  const j={...job,type:"Brown Bin"};
  assert.notEqual(additionalBinKey(a,bin),additionalBinKey(b,bin));
  assert.notEqual(additionalJobKey(a,j),additionalJobKey(b,j));
  assert.equal(additionalBinKey(a,bin),additionalBinKey(a,{...bin,count:2}));
  const store=makeStore();
  const one=await claimOnce({key:additionalBinKey(a,bin),bookingId:a.bookingId,store});
  const duplicate=await claimOnce({key:additionalBinKey(a,bin),bookingId:a.bookingId,store});
  const second=await claimOnce({key:additionalBinKey(b,bin),bookingId:b.bookingId,store});
  assert.equal(one.acquired,true);
  assert.equal(duplicate.acquired,false);
  assert.equal(second.acquired,true);
});
