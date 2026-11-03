"use strict";
// Build a single signed-terms master from the canonical September 2026 text.
// This runs AFTER updating the website Terms and BEFORE Netlify bundles
// functions. No customer data is ever written into this reusable PDF.
const fs=require("node:fs");
const path=require("node:path");
const {PDFDocument}=require("pdf-lib");
const {
  MASTER_RELATIVE,FINGERPRINT,createPreparedTermsMaster,
}=require("../netlify/functions/lib/preparedTermsPdf");
async function main(){
  const root=path.resolve(__dirname,"..");
  const image=fs.readFileSync(path.join(root,"public/logo.png"));
  const bytes=await createPreparedTermsMaster({logoBytes:image});
  const check=await PDFDocument.load(bytes);
  if(check.getSubject()!==FINGERPRINT||check.getPageCount()<3){
    throw new Error("Invalid or incomplete September 2026 PDF master");
  }
  const output=path.join(root,MASTER_RELATIVE);
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,bytes);
  console.log("Prepared the September 2026 master Terms PDF: "+
    check.getPageCount()+" pages, "+bytes.length+" bytes");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
