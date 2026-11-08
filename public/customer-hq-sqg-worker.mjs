import SevenZip from "./vendor/sqg-7zip/7zz.es6.js";
import {SCORE_VERSION,PENALTY_SOURCE_VERSION,makeState,acceptSqueegeeRecord,finishSqueegeeImport} from "./customer-hq-sqg-converter.mjs?v=overdue-xp-v1-20261108";

// Pinned upstream open-source 7-Zip WASM. The decoder alone is downloaded;
// Squeegee customer data is never uploaded to GitHub or the decoder provider.
const WASM="https://raw.githubusercontent.com/use-strict/7z-wasm/521d2cf93f5964f4e77b01049e19f1b29305c454/7zz.wasm";
const MAGIC=[0x37,0x7a,0xbc,0xaf,0x27,0x1c];
const emit=(stage,percent)=>self.postMessage({type:"progress",stage,percent});
function checkMagic(bytes){
 return MAGIC.every((v,i)=>bytes[i]===v);
}
function parseRow(text,state){
 let line=text.trim();
 if(!line||line==="["||line==="]")return;
 if(line.startsWith("["))line=line.slice(1).trim();
 if(line.endsWith(","))line=line.slice(0,-1).trim();
 if(line==="]")return;
 if(!line)return;
 acceptSqueegeeRecord(state,JSON.parse(line));
}
async function convert(file,previous){
 if(!file||!/\.(sqg|7z)$/i.test(file.name)||file.size<10000||
   file.size>65_000_000)throw Error("Select a regular Squeegee .sqg backup under 65 MB.");
 emit("Reading your Squeegee backup on this device",2);
 const bytes=new Uint8Array(await file.arrayBuffer());
 if(!checkMagic(bytes))throw Error("This file is not a genuine Squeegee 7-Zip archive.");
 emit("Opening the Squeegee archive",8);
 const zip=await SevenZip({
   locateFile:()=>WASM,
   print:()=>{},
   printErr:()=>{}
 });
 const FS=zip.FS;
 FS.mkdir("/sqg-out");
 const fileHandle=FS.open("/private-backup.sqg","w+");
 FS.write(fileHandle,bytes,0,bytes.length);
 FS.close(fileHandle);
 emit("Unpacking securely on your phone — nothing has been uploaded",15);
 let extractError=null;
 try {zip.callMain(["x","-y","/private-backup.sqg","-o/sqg-out"]);}
 catch(err) {extractError=err;}
 const content=FS.readdir("/sqg-out").filter(x=>/^data-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.json$/.test(x));
 if(content.length!==1)
  throw Error("Cannot find the Squeegee data file in this backup. "+
    (extractError?String(extractError):""));
 const found=content[0],asOf=found.slice(5,15);
 const pathname="/sqg-out/"+found,stat=FS.stat(pathname);
 if(stat.size<10000000||stat.size>500000000)
  throw Error("The extracted Squeegee data exceeds the supported safety range.");
 emit("Checking customers, completed cleans and payments",30);
 const state=makeState();
 const handle=FS.open(pathname,"r"),block=new Uint8Array(512*1024);
 const decoder=new TextDecoder("utf-8",{fatal:true});
 let carry="",read=0,latest=0;
 try {
  while(read<stat.size) {
   const count=FS.read(handle,block,0,block.length);
   if(count<=0)break;
   read+=count;
   carry+=decoder.decode(block.subarray(0,count),{stream:true});
   let pos;
   while((pos=carry.indexOf("\n"))>=0) {
    parseRow(carry.slice(0,pos),state);
    carry=carry.slice(pos+1);
   }
   if(carry.length>10000000)
    throw Error("Unexpectedly long Squeegee record — import stopped safely.");
   const progress=30+Math.floor(55*read/stat.size);
   if(progress>=latest+3){latest=progress;emit("Recalculating paid bins and streaks",progress);}
  }
  carry+=decoder.decode();
  if(carry.trim())parseRow(carry,state);
 }finally{FS.close(handle);}
 if(read!==stat.size)
  throw Error("The archive finished early; no customer data was imported.");
 emit("Reconciling private leaderboard scores",92);
 const outcome=finishSqueegeeImport(state,asOf,previous||{});
 if(outcome?.snapshot?.scoringVersion!==SCORE_VERSION||
    SCORE_VERSION!=="2026-11-streak-20-plus-2-per-job-per-paid-bin-v2")
   throw Error("The Squeegee scoring module is outdated. Reload the import page before retrying.");
 emit("Verified private per-job points ready to import",98);
 return outcome;
}
self.onmessage=async e=>{
 const {file,previous}=e.data||{};
 try{
  const result=await convert(file,previous);
  self.postMessage({type:"complete",result});
 }catch(error){
  const missingJob=error?.message==="missing_squeegee_recurring_job_id"||
    error?.message==="invalid_or_conflicting_squeegee_job_id";
  const occurrenceMismatch=error?.message==="invalid_squeegee_occurrence_job_date";
  const conflictingTransfer=["squeegee_job_shared_active_customers",
    "squeegee_job_date_conflicts_between_customers"].includes(error?.message);
  self.postMessage({type:"error",
   message:missingJob?
    "The Squeegee backup did not provide a reliable recurring job ID for each clean. Per-job streaks cannot be verified, so NO scores have been replaced. Please ask NI Bin Guy to review the backup format.":
    occurrenceMismatch?
    "A Squeegee cleaning occurrence does not match its recurring job and due date. No scores have been changed. Please report this diagnostic to NI Bin Guy.":
    conflictingTransfer?
    "A transferred Squeegee job is assigned to two active customers or the same cleaning date. No scores have been replaced; this job requires owner review.":
    typeof error?.message==="string"?error.message:"Unable to process this backup safely."});
 }
};
