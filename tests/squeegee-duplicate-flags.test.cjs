"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {
  detectDuplicateSignals,matchCustomersAcrossPages,
}=require("../netlify/functions/lib/squeegeeCustomerMatcher");
const {
  duplicateSignalsEmailContent,notifyOwnerOfDuplicateSignals,
  emailContent,allowedFlags,duplicateFlagLabels,
}=require("../netlify/functions/lib/squeegeeSyncOwnerAlert");

const ID1="33333333-3333-4333-8333-333333333333";
const ID2="44444444-4444-4444-8444-444444444444";
const ID3="55555555-5555-4555-8555-555555555555";
const booking={
  bookingId:"NBG-EXAMPLE-ABCDEFGH",
  name:"Example Person",
  address:"7 Example Drive, Bangor BT19 7ZW",
  email:"new@example.org",
  phone:"02891460000",
};
const own=(extra={})=>({
  _id:ID1,name:booking.name,
  address:{addressDescription:booking.address},
  email:booking.email,phoneNumber:booking.phone,status:"active",
  ...extra,
});
const another=(extra={})=>({
  _id:ID2,name:"Other Property",
  address:{addressDescription:"14 Ocean Street, Holywood BT18 9ZZ"},
  email:"someone-else@example.org",phoneNumber:"07700900000",
  status:"active",...extra,
});
async function scan(rows,{pages=19,split=false}={}){
  return matchCustomersAcrossPages(booking,async({page})=>({
    customers:split?(page===1?rows.slice(0,1):
      page===pages?rows.slice(1):[]):page===pages?rows:[],
    page,hasMore:page<pages,pageSize:100,
  }),{maxPages:100});
}
test("email already registered at another postcode is flagged but does not block a second property",async()=>{
  const b=another({email:" NEW@EXAMPLE.ORG "});
  const found=await scan([b]);
  assert.equal(found.status,"not_found");
  assert.equal(found.relatedContactAtDifferentAddress,true);
  assert.equal(found.pagesScanned,19);
  assert.deepEqual(found.duplicateFlags,[
    "email_already_registered","email_used_at_other_property",
  ]);
});
test("existing exact address and email create informational flags, not a booking block",async()=>{
  const found=await scan([own()]);
  assert.equal(found.status,"matched");
  assert.equal(found.reason,"exact_property_and_name");
  assert.deepEqual(found.duplicateFlags,[
    "email_already_registered","address_already_registered",
    "phone_already_registered",
  ]);
});
test("same name/address with changed email and phone is identified as existing, with a changed-contact flag",async()=>{
  const found=await scan([own({email:"old@example.org",
    phoneNumber:"02891469999"})]);
  assert.equal(found.status,"matched");
  assert.equal(found.reason,"exact_property_and_name");
  assert.deepEqual(found.duplicateFlags,[
    "address_already_registered","same_name_address_contact_changed",
  ]);
});
test("same address under another name is flagged AND remains held for review",async()=>{
  const found=await scan([own({name:"Other Resident",
    email:"other@example.org",phoneNumber:"07700900000"})]);
  assert.equal(found.status,"needs_review");
  assert.equal(found.reason,"same_address_without_name_or_contact_match");
  assert.deepEqual(found.duplicateFlags,[
    "address_already_registered","address_registered_to_other_name",
  ]);
});
test("duplicate emails across several Squeegee accounts get one grouped signal per category",async()=>{
  const found=await scan([
    own(),
    another({email:booking.email}),
    another({_id:ID3,email:booking.email,
      address:{addressDescription:"33 Other Street, Comber BT23 5PL"}}),
  ],{split:true});
  assert.equal(found.status,"matched");
  assert.deepEqual(found.duplicateFlags,[
    "email_already_registered","email_used_at_other_property",
    "multiple_records_with_email","address_already_registered",
    "phone_already_registered",
  ]);
});
test("multiple distinct records at one address receive an address-duplication flag",()=>{
  const flags=detectDuplicateSignals(booking,[
    own(),own({_id:ID2,email:"second@example.org",name:"Another Person",
      phoneNumber:"07700900000"}),
  ]);
  assert.ok(flags.includes("address_already_registered"));
  assert.ok(flags.includes("multiple_records_at_address"));
  assert.ok(flags.includes("address_registered_to_other_name"));
});
test("same phone at another address is flagged without equating two properties",async()=>{
  const found=await scan([another({phoneNumber:"+442891460000"})]);
  assert.equal(found.status,"not_found");
  assert.ok(found.duplicateFlags.includes("phone_already_registered"));
  assert.ok(found.duplicateFlags.includes("phone_used_at_other_property"));
  assert.ok(!found.duplicateFlags.includes("address_already_registered"));
});
test("same house number and postcode on different street is possible address duplicate, not an exact match",async()=>{
  const found=await scan([own({
    email:"another@example.org",phoneNumber:"07700900000",
    address:{addressDescription:"7 Another Road, Bangor BT19 7ZW"},
  })]);
  assert.equal(found.status,"needs_review");
  assert.equal(found.reason,"possible_existing_address");
  assert.deepEqual(found.duplicateFlags,["possible_duplicate_address"]);
});
test("duplicate ID repeated on separate pages cannot inflate duplicate counts",async()=>{
  const found=await scan([own(),own()],{split:true,pages:2});
  assert.equal(found.status,"matched");
  assert.ok(!found.duplicateFlags.includes("multiple_records_with_email"));
  assert.ok(!found.duplicateFlags.includes("multiple_records_at_address"));
});
test("incomplete pagination cannot claim a full duplicate scan",async()=>{
  const found=await matchCustomersAcrossPages(booking,async({page})=>({
    customers:page===1?[own()]:[],hasMore:true,page,pageSize:100,
  }),{maxPages:2});
  assert.equal(found.status,"needs_review");
  assert.equal(found.reason,"customer_pagination_limit");
  assert.equal(found.duplicateFlags,undefined);
});
test("owner alert for successful flagged booking uses codes only, no names/emails/addresses",async()=>{
  const flags=[
    "email_already_registered","email_used_at_other_property",
    "address_already_registered","address_registered_to_other_name",
  ];
  const message=duplicateSignalsEmailContent(booking.bookingId,flags);
  assert.match(message.subject,/duplicate details flagged/);
  assert.match(message.text,/Same email is associated with another service property/);
  assert.match(message.text,/Service address already exists in Squeegee/);
  assert.match(message.text,/informational flag/);
  assert.ok(!message.text.includes(booking.email));
  assert.ok(!message.text.includes("Example Drive"));
  assert.ok(!message.text.includes(booking.name));
  let messages=[];
  const result=await notifyOwnerOfDuplicateSignals(booking.bookingId,flags,{
    env:{BOOKINGS_TO:"info@nibing.uy",
      RESEND_FROM:"NI Bin Guy <noreply@nibing.uy>"},
    send:async msg=>{messages.push(msg);return{data:{id:"fake-id"}};},
  });
  assert.equal(result.sent,true);
  assert.equal(messages.length,1);
  assert.deepEqual(messages[0].to,["info@nibing.uy"]);
  assert.equal(messages[0].text,message.text);
});
test("held-booking alerts include known duplicate codes and redact arbitrary strings",()=>{
  const email=emailContent(booking.bookingId,"customer_match_ambiguous_or_incomplete",{
    duplicateFlags:["address_already_registered",
      "email_used_at_other_property","bad<script>","email_used_at_other_property"],
    matchReason:"same_address_without_name_or_contact_match",
  });
  assert.match(email.text,/Duplicate flag: Service address already exists/);
  assert.match(email.text,/Same email is associated/);
  assert.ok(!email.text.includes("<script>"));
  assert.deepEqual(allowedFlags(["email_already_registered","unknown",null]),
    ["email_already_registered"]);
  assert.deepEqual(duplicateFlagLabels(["address_already_registered"]),
    ["Service address already exists in Squeegee"]);
});
test("no matched fields, invalid booking refs, or email delivery failure must not interfere with jobs",async()=>{
  assert.equal(duplicateSignalsEmailContent(booking.bookingId,[]),null);
  assert.equal(duplicateSignalsEmailContent("invalid",["email_already_registered"]),null);
  assert.deepEqual(detectDuplicateSignals(booking,[]),[]);
  let calls=0;
  const r=await notifyOwnerOfDuplicateSignals(booking.bookingId,
    ["address_already_registered"],{
      env:{BOOKINGS_TO:"info@nibing.uy"},
      send:async()=>{calls++;throw Error("simulated provider failure");},
    });
  assert.equal(r.sent,false);
  assert.equal(calls,1);
});
test("read-only owner status page renders duplicate labels without exposing record details",()=>{
  const code=fs.readFileSync(path.join(__dirname,
    "../netlify/functions/squeegeePreviewAutoStatus.mjs"),"utf8");
  assert.match(code,/duplicateFlagLabels\(status\.duplicateFlags\)/);
  assert.match(code,/Duplicate information detected/);
  assert.match(code,/Repeated emails can be legitimate/);
  assert.match(code,/safe\(label\)/);
});
