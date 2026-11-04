"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const root=path.resolve(__dirname,"..");
const cert=require("../netlify/functions/lib/squeegeeOwnerCertificate");
const dispatch=require("../netlify/functions/lib/squeegeePreviewAutoDispatch");
const {withActualOwnerCertificateStatus}=require(
  "../netlify/functions/lib/ownerBookingTermsSummary");
const {notifyOwnerOfCompletedBooking}=require(
  "../netlify/functions/lib/squeegeeSyncOwnerAlert");
const ID="NBG-PQ5WEEUM";
const NAME="Ni-Bin-Guy-Terms-Acceptance-james.pdf";
// Full-size PDF regression: the original customer attachment is ~1.2 MB.
// We do NOT pass this into the signed dispatch request.
function attachment(){
  const bytes=Buffer.concat([
    Buffer.from("%PDF-1.7\n"),
    Buffer.alloc(1_190_000,65),
    Buffer.from("\n%%EOF\n"),
  ]);
  return {filename:NAME,content:bytes.toString("base64"),
    contentType:"application/pdf"};
}
function fakeStore(){
  const data=new Map();
  return {
    data,
    async setJSON(id,entry,{onlyIfNew}={}){
      if(onlyIfNew&&data.has(id))return{modified:false};
      data.set(id,JSON.parse(JSON.stringify(entry)));
      return{modified:true,etag:'"pdf-staged-123"'};
    },
    async get(id){return data.get(id)||null;},
    async delete(id){data.delete(id);},
  };
}
function receipt(digest){
  return {subject:"🗑️ New Bin Cleaning Booking (website)",
    text:"New Bin Cleaning Booking\nTerms & Conditions Acceptance Certificate PDF attached (customer copy).",
    html:"<h2>New Bin Cleaning Booking</h2><p>"+
      "Terms &amp; Conditions Acceptance Certificate PDF attached (customer copy)."+
      "</p>"+("Original receipt. ".repeat(10)),
    termsBody:"These are the accepted terms and conditions. ".repeat(5),
    binsText:"1 x Brown Bin",pricingText:"£5",
    ...(digest?{ownerPdfSha256:digest}:{})};
}
test("original 1.2 MB certificate is preserved byte-for-byte without entering signed event",async()=>{
  const original=attachment();
  const store=fakeStore();
  const saved=await cert.storeCustomerCertificate(ID,original,store);
  assert.match(saved.sha256,/^[a-f0-9]{64}$/);
  assert.equal(store.data.size,1);
  const loaded=await cert.loadCustomerCertificate(ID,saved.sha256,store);
  assert.deepEqual(loaded,original);
  assert.equal(crypto.createHash("sha256").update(
    Buffer.from(loaded.content,"base64")).digest("hex"),saved.sha256);
  const body=JSON.stringify({channel:"email",
    booking:{bookingId:ID},ownerReceipt:dispatch.normalOwnerReceipt(receipt(saved.sha256))});
  assert.ok(body.length<30_000);
  assert.ok(!body.includes(original.content.slice(0,500)));
  const timestamp=String(Date.parse("2026-10-31T23:04:00Z"));
  const env={SQUEEGEE_API_KEY:"test-only-signed-booking-certificate-secret-key"};
  const signature=dispatch.signAcceptedEvent(body,timestamp,env);
  assert.equal(dispatch.verifyAcceptedEvent(body,timestamp,signature,env,
    Number(timestamp)+1000),true);
  assert.equal(dispatch.verifyAcceptedEvent(body.replace(saved.sha256,"0".repeat(64)),
    timestamp,signature,env,Number(timestamp)+1000),false);
});
test("one deferred owner confirmation sends the saved PDF through Resend, then cleans up",async()=>{
  const original=attachment(),store=fakeStore(),sent=[];
  const saved=await cert.storeCustomerCertificate(ID,original,store);
  const loaded=await cert.loadCustomerCertificate(ID,saved.sha256,store);
  const normal=dispatch.normalOwnerReceipt(receipt(saved.sha256));
  const selected=withActualOwnerCertificateStatus(normal,true);
  const result=await notifyOwnerOfCompletedBooking(ID,selected,{
    attachments:[loaded],send:async message=>{
      sent.push(message);return {data:{id:"simulated-provider-acceptance"}};
    },
  });
  assert.equal(result.sent,true);
  assert.equal(sent.length,1);
  assert.equal(sent[0].attachments.length,1);
  assert.deepEqual(sent[0].attachments[0],original);
  assert.match(sent[0].text,/Certificate PDF attached/);
  assert.match(sent[0].html,/Certificate PDF attached/);
  await store.delete(ID);
  assert.equal(store.data.size,0);
});
test("missing certificate changes BOTH owner HTML and text to remove false attachment claim",async()=>{
  const stale=receipt("f".repeat(64));
  const prepared=withActualOwnerCertificateStatus(stale,false);
  assert.match(prepared.text,/PDF not attached to this owner email/);
  assert.match(prepared.html,/PDF not attached to this owner email/);
  assert.ok(!prepared.text.includes("PDF attached (customer copy)"));
  assert.ok(!prepared.html.includes("PDF attached (customer copy)"));
  const sent=[];
  await notifyOwnerOfCompletedBooking(ID,prepared,{
    send:async m=>{sent.push(m);return {data:{id:"sent-without-pdf"}};},
  });
  assert.equal(sent.length,1);
  assert.equal(sent[0].attachments,undefined);
});
test("private certificate lookup fails on wrong reference, corrupt bytes or invalid PDF",async()=>{
  const stored=fakeStore(),original=attachment();
  const signed=await cert.storeCustomerCertificate(ID,original,stored);
  await assert.rejects(()=>cert.loadCustomerCertificate("NBG-3FYB9UY4",signed.sha256,stored),
    /missing_or_mismatched/);
  await assert.rejects(()=>cert.loadCustomerCertificate(ID,"0".repeat(64),stored),
    /missing_or_mismatched/);
  stored.data.get(ID).content=Buffer.from("not a PDF").toString("base64");
  await assert.rejects(()=>cert.loadCustomerCertificate(ID,signed.sha256,stored),
    /invalid_owner_certificate/);
  await assert.rejects(()=>cert.storeCustomerCertificate(ID,{
    ...original,content:Buffer.from("not a PDF").toString("base64")},fakeStore()),
    /invalid_owner_certificate/);
  assert.equal(dispatch.normalOwnerReceipt({
    ...receipt(),ownerPdfSha256:"malicious-not-a-checksum"}),null);
});
test("failure to save cannot claim the attachment is available for owner send",async()=>{
  const store=fakeStore();
  const saved=await cert.storeCustomerCertificate(ID,attachment(),store);
  await assert.rejects(()=>cert.storeCustomerCertificate(ID,attachment(),store),
    /not_durably_stored/);
  assert.equal(dispatch.normalOwnerReceipt(receipt(saved.sha256)).ownerPdfSha256,
    saved.sha256);
  const sender=fs.readFileSync(path.join(root,"netlify/functions/sendBookingEmail.js"),"utf8");
  const worker=fs.readFileSync(path.join(root,"netlify/functions/squeegeePreviewAutoSync.mjs"),"utf8");
  assert.match(sender,/getStoreSafe\(productionSyncEnabled\?/);
  assert.match(sender,/productionGuard\.CERT_STORE:ownerCertificate\.STORE/);
  assert.ok(sender.includes("ownerReceipt.ownerPdfSha256=stagedOwnerPdfSha"));
  assert.ok(sender.indexOf("ownerCertificate.storeCustomerCertificate") <
    sender.indexOf("const claim = await claimBookingSubmission"));
  assert.ok(sender.includes("statusCode: 424"));
  assert.ok(worker.includes("ownerCertificateStore.delete(bookingId)"));
  assert.ok(!worker.includes('import("./lib/termsPdf.js")'));
});
