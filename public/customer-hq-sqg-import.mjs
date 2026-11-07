// Owner-only browser import: .sqg stays on this device, validated JSON sent to
// NI Bin Guy. No third-party uploader, API key, or unverified scoring shortcut.
const form=document.getElementById("hq-history-upload-form");
const input=document.getElementById("hq-history-file");
const error=document.getElementById("hq-upload-error");
const progress=document.getElementById("hq-upload-progress");
const button=document.getElementById("hq-import-button");
if(form&&input&&error&&button&&progress){
 button.disabled=false;
 let busy=false;
 const explain=(text)=>{
  error.textContent=text;error.setAttribute("role","status");
 };
 function check(file){
  if(!file)return "Choose your latest Squeegee backup (.sqg).";
  if(/\.json$/i.test(file.name)){
   if(file.size<100||file.size>3800000)
    return "The prepared JSON must be between 100 bytes and 3.8 MB.";
   return "";
  }
  if(!/\.sqg$/i.test(file.name))
   return "Please choose your Squeegee backup ending in .sqg.";
  if(file.size<10000||file.size>65000000)
   return "This backup is outside the supported size range (10 KB–65 MB).";
  return "";
 }
 input.addEventListener("change",()=>{
  if(!busy){explain(check(input.files?.[0]));}
 });
 form.addEventListener("submit",async event=>{
  event.preventDefault();
  if(busy)return;
  const file=input.files?.[0],message=check(file);
  if(message){explain(message);error.focus();return;}
  if(/\.json$/i.test(file.name)){form.submit();return;}
  busy=true;button.disabled=true;input.disabled=true;
  progress.style.display="block";progress.value=0;
  let worker;
  try{
   explain("Preparing your private Squeegee backup. Keep this page open.");
   const refs=await fetch(form.action+"?referenceMap=1",{
    credentials:"same-origin",cache:"no-store",
    headers:{"Accept":"application/json"}});
   if(!refs.ok)throw Error("Your owner session has expired. Sign in again.");
   const baseline=await refs.json(),previous={};
   for(const r of baseline.records||[]){
    if(typeof r?.id==="string")previous[r.id]={
      ref:r.ref,town:r.town,firstName:r.firstName};
   }
   const result=await new Promise((resolve,reject)=>{
    worker=new Worker("/customer-hq-sqg-worker.mjs",{type:"module"});
    worker.onerror=()=>reject(Error("The secure archive decoder could not start on this device."));
    worker.onmessage=e=>{
      const data=e.data||{};
      if(data.type==="progress"){
       progress.value=Number(data.percent)||0;
       explain(data.stage||"Processing your backup");
      }else if(data.type==="error"){
       reject(Error(data.message||"Backup validation failed."));
      }else if(data.type==="complete")resolve(data.result);
    };
    worker.postMessage({file,previous});
   });
   worker.terminate();worker=null;
   const text=JSON.stringify(result.snapshot);
   const bytes=new Blob([text],{type:"application/json"});
   if(bytes.size<100||bytes.size>3800000)
    throw Error("The verified Customer HQ data is unexpectedly large; no scores were changed.");
   progress.value=99;
   explain("Uploading "+result.summary.verifiedPaidBins.toLocaleString("en-GB")+
    " verified paid bins, securely saving customer history and consent choices…");
   const body=new FormData();
   body.append("csrf",form.querySelector('input[name="csrf"]').value);
   body.append("history",bytes,"NI_Bin_Guy_Customer_HQ_Private_"+result.snapshot.asOf+".json");
   const response=await fetch(form.action,{method:"POST",credentials:"same-origin",
    body,cache:"no-store",redirect:"follow"});
   const reply=await response.text();
   if(!response.ok){
    const plain=reply.replace(/<[^>]*>/g," ").replace(/\s+/g," ").slice(0,300);
    throw Error("The website withheld the new points: "+plain);
   }
   progress.value=100;
   document.open();document.write(reply);document.close();
  }catch(err){
   explain("No scores have been replaced. "+
    (typeof err?.message==="string"?err.message:"Backup processing failed."));
   progress.style.display="none";
  }finally{
   worker?.terminate();
   busy=false;input.disabled=false;button.disabled=false;
  }
 });
}
