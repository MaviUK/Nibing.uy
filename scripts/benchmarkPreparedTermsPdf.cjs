"use strict";
// Offline performance benchmark: no customer writes, emails or Squeegee calls.
const fs=require("node:fs");
const path=require("node:path");
const {performance}=require("node:perf_hooks");
const {PDFDocument}=require("pdf-lib");
const {buildTermsAcceptancePdfAttachmentLegacy,
  buildTermsAcceptancePdfAttachment}=require("../netlify/functions/lib/termsPdf");
const TERMS=require("../src/data/bookingTerms.json");
const fixture={
  name:"EXAMPLE CUSTOMER",email:"example.customer@example.org",
  phone:"02890000000",address:"17 Test Road, Bangor BT20 4AA",
  binsText:"1 x Black Bin (4 Weekly)",
  pricingText:"Pricing:\n1 x Black Bin: GBP 5\n\nSubtotal: GBP 5\nTotal: GBP 5\n\nDiscount Code: None",
  termsAccepted:true,termsVersion:TERMS.version,
  termsAcceptanceText:"I confirm that I have read and agree to the September 2026 Terms of Service, including the public leaderboard acknowledgement.",
  termsTimestamp:"2026-11-03T17:00:00.000Z",
  termsBody:TERMS.body,source:"website",
};
async function sample(fn){
  const start=performance.now();
  const result=await fn(fixture);
  const duration=performance.now()-start;
  if(!result?.content||result.contentType!=="application/pdf")
    throw new Error("Expected a complete PDF certificate");
  return {duration,result};
}
const median=nums=>{
  const ordered=[...nums].sort((a,b)=>a-b);
  return ordered.length%2?ordered[(ordered.length-1)/2]:
    (ordered[ordered.length/2-1]+ordered[ordered.length/2])/2;
};
async function main(){
  const root=path.resolve(__dirname,"..");
  const master=path.join(root,"netlify/functions/lib/assets/terms-september-2026-master.pdf");
  if(!fs.existsSync(master))throw new Error("Build the master Terms PDF before benchmarking");
  for(let i=0;i<3;i++){
    await sample(buildTermsAcceptancePdfAttachmentLegacy);
    await sample(buildTermsAcceptancePdfAttachment);
  }
  const legacy=[],prepared=[];
  let attachment=null;
  for(let i=0;i<12;i++){
    legacy.push((await sample(buildTermsAcceptancePdfAttachmentLegacy)).duration);
    const result=await sample(buildTermsAcceptancePdfAttachment);
    prepared.push(result.duration);
    if(!attachment)attachment=result.result;
  }
  const oldMs=median(legacy),newMs=median(prepared);
  const fakePdf=path.join(root,"prepared-terms-qa-example.pdf");
  fs.writeFileSync(fakePdf,Buffer.from(attachment.content,"base64"));
  const doc=await PDFDocument.load(Buffer.from(attachment.content,"base64"));
  console.log("PDF_BENCHMARK "+JSON.stringify({
    oldMedianMs:Math.round(oldMs),
    preparedMedianMs:Math.round(newMs),
    medianSavedMs:Math.round(oldMs-newMs),
    percentFaster:Math.round(100*(oldMs-newMs)/oldMs),
    oldSamples:legacy.length,newSamples:prepared.length,
    pages:doc.getPageCount(),bytes:Buffer.byteLength(attachment.content,"base64"),
    sampleFile:"prepared-terms-qa-example.pdf",
  }));
  console.log("This is PDF generation only, not the full booking/email/Squeegee submission.");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
