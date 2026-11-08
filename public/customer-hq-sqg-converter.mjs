// Runs in the owner's browser. The complete .sqg never leaves their device.
export const SCORE_VERSION="2026-11-streak-20-plus-2-per-job-per-paid-bin-v2";
export const PENALTY_SOURCE_VERSION="2026-11-escalating-overdue-per-job-v2";
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const REF=/^(?:\d{1,12}|CUS\d{1,15}|[Aa]{2}\d{3,8})$/;
const EMAIL=/^[^\s@]{1,80}@[^\s@]{1,160}\.[^\s@]{2,24}$/;
const FIRST=/^[\p{L}][\p{L}'’\-]{0,39}$/u;
const TOWNS=["Newtownards","Donaghadee","Carrowdore","Groomsport","Crawfordsburn",
 "Newtownbreda","Ballyhackamore","Ballyhalbert","Ballyrobert","Ballyholme",
 "Ballygowan","Ballywalter","Moneyreagh","Portaferry","Portavogie","Greyabbey",
 "Holywood","Millisle","Cloughey","Belfast","Conlig","Comber","Bangor",
 "Kircubbin","Dundonald","Helens Bay"];
function validDay(x) {
 return typeof x==="string" && /^\d{4}-\d{2}-\d{2}$/.test(x) &&
  !Number.isNaN(Date.parse(x+"T12:00:00Z")) &&
  new Date(x+"T12:00:00Z").toISOString().slice(0,10)===x;
}
function firstName(name) {
 if(typeof name!=="string")return "";
 const cleaned=name.trim().replace(/^(mr|mrs|miss|ms|dr|prof)\.?\s+/i,"");
 const word=cleaned.split(/[\s,;/]+/).find(Boolean)||"";
 return FIRST.test(word)?word:"";
}
function townFromAddress(text) {
 if(typeof text!=="string")return "Town unavailable";
 const input=text.replace(/['’]/g,"").toLowerCase().replace(/\s+/g," ");
 const matches=TOWNS.filter(t=>new RegExp("(?:^|[ ,])"+
   t.toLowerCase()+"(?:[ ,]|$)").test(input));
 return matches.length===1?matches[0]:"Town unavailable";
}
function quantityOf(service) {
 const text=String(service?.description||"").toUpperCase();
 if(/SURCHARGE|SPEACIAL PRICE|SPECIAL PRICE|GLASS|CADDY|FECES|FAECES/.test(text))
  return 0;
 const colors=["BLACK","BROWN","BLUE","GREEN"].filter(c=>
  new RegExp("\\b"+c+"\\b").test(text));
 if(!colors.length)return 0;
 const matches=[...text.matchAll(/\b(\d{1,2})\s*[X×]\s*(BLACK|BROWN|BLUE|GREEN)\b/g)];
 if(matches.length) {
  const total=matches.reduce((a,m)=>a+Number(m[1]),0);
  return total>=1&&total<=20?total:0;
 }
 if(colors.length>1)return colors.length;
 const q=service?.quantity===undefined||service.quantity===null?1:Number(service.quantity);
 return Number.isSafeInteger(q)&&q>=1&&q<=20?q:0;
}
// Each Squeegee job has a stable ID shared by its dated occurrences.
// Never infer job identity from bin colour, customer ID or occurrence ID:
// multiple Brown jobs can coexist on one customer account.
function recurringJobId(row) {
 const candidates=[row.jobId,row.job?._id,row.job?.id]
  .filter(value=>value!==null&&value!==undefined&&value!=="");
 if(!candidates.length)throw Error("missing_squeegee_recurring_job_id");
 const keys=candidates.map(value=>String(value).toLowerCase());
 if(keys.some(value=>!UUID.test(value))||new Set(keys).size!==1)
  throw Error("invalid_or_conflicting_squeegee_job_id");
 return keys[0];
}
function jobLabel(services) {
 const names=[...new Set((services||[]).flatMap(service=>{
  const upper=String(service?.description||"").toUpperCase();
  return ["BLACK","BROWN","BLUE","GREEN"].filter(colour=>
   new RegExp("\\b"+colour+"\\b").test(upper));
 }))];
 return names.length?names.map(name=>name[0]+name.slice(1).toLowerCase()).join(" + "):
  "Other job";
}
export function makeState() {
 return {customers:new Map(),invoices:new Map(),balance:new Map(),
  occurrences:[],jobOwners:new Map(),occurrenceIds:new Map(),records:0,types:new Map()};
}
export function acceptSqueegeeRecord(state,row) {
 if(!row||typeof row!=="object")throw Error("invalid_export_record");
 const kind=row.resourceType;state.records++;
 state.types.set(kind,(state.types.get(kind)||0)+1);
 if(kind==="customers") {
  if(row.state==="active"&&!row._deleted&&UUID.test(String(row._id||"")))
   state.customers.set(row._id.toLowerCase(),{
    id:row._id.toLowerCase(),ref:String(row._externalId||""),
    email:String(row.email||""),name:String(row.name||""),
    address:String(row.address?.addressDescription||"")});
  return;
 }
 if(kind==="transactions") {
  const id=String(row.customerId||"").toLowerCase();
  if(!row._deleted&&UUID.test(id)&&typeof row.amount==="number"&&
     Number.isFinite(row.amount))
   state.balance.set(id,(state.balance.get(id)||0)+row.amount);
  if(row.transactionType===0&&UUID.test(String(row._id||"")))
   state.invoices.set(row._id.toLowerCase(),{
    customerId:id,paid:row.invoice?.paid===true,deleted:!!row._deleted});
  return;
 }
 if(kind==="joboccurrences"&&[1,2].includes(row.status)&&!row._deleted) {
  if(!UUID.test(String(row.customerId||"")))return;
  const date=String(row.isoDueDate||row.isoCompletedDate||"").slice(0,10);
  if(!validDay(date))return;
  const jobId=recurringJobId(row);
  const occurrenceId=String(row._id||"").toLowerCase();
  // Squeegee's real .sqg export uses a date-qualified occurrence key:
  // 36-character recurring job UUID followed by YYYY-MM-DD (46 characters).
  // The prefix and day MUST match this occurrence's own job and due date;
  // accepting any 46-character string would silently mis-attribute streaks.
  // The standalone UUID form remains supported for older exports and fixtures.
  if(!occurrenceId)
   throw Error("missing_squeegee_occurrence_id");
  if(!UUID.test(occurrenceId)&&occurrenceId!==jobId+date)
   throw Error("invalid_squeegee_occurrence_job_date");
  const customerId=row.customerId.toLowerCase();
  const services=(row.services||[]).map(s=>({
    description:String(s?.description||""),quantity:s?.quantity}));
  const record={id:occurrenceId,jobId,customerId,date,status:row.status,services,
   invoiceId:String(row.invoiceTransactionId||"").toLowerCase(),
   paymentStatus:row.paymentStatus,paidDate:row.paidDate||null};
  const signature=JSON.stringify(record);
  const earlier=state.occurrenceIds.get(occurrenceId);
  if(earlier!==undefined){
   if(earlier!==signature)throw Error("conflicting_squeegee_occurrence");
   return;
  }
  // Squeegee may transfer an existing recurring job to a new customer.
  // The 6 Nov backup contains historical inactive owners and one current
  // active owner for 10 job IDs. Preserve the job ID but NEVER combine the
  // previous customer's attendance streak with the current customer's.
  let owners=state.jobOwners.get(jobId);
  if(!owners){owners=new Map();state.jobOwners.set(jobId,owners);}
  for(const [ownerId,days] of owners){
   if(ownerId!==customerId&&days.has(date))
    throw Error("squeegee_job_date_conflicts_between_customers");
  }
  if(!owners.has(customerId))owners.set(customerId,new Set());
  owners.get(customerId).add(date);
  state.occurrenceIds.set(occurrenceId,signature);
  state.occurrences.push(record);
 }
}
function cleanEmail(raw){
 const e=String(raw||"").trim().toLowerCase();
 return EMAIL.test(e)?e:"";
}
function makeCustomer(c,prior){
 const ref=String(c.ref||"");
 if(!REF.test(ref))throw Error("unverified_squeegee_customer_reference");
 const old=prior?.[c.id];
 const town=old?.ref===ref&&TOWNS.includes(old?.town)?
   old.town:townFromAddress(c.address);
 const name=old?.ref===ref&&FIRST.test(old?.firstName||"")?
   old.firstName:firstName(c.name);
 return {id:c.id,ref,email:cleanEmail(c.email),firstName:name,town,
  points:0,paidCleans:0,currentStreak:0,nextBonus:20,
  recordedSkips:0,events:[],jobs:[],balanceState:"unknown",outstandingJobs:[],settledJobs:[]};
}
export function finishSqueegeeImport(state,asOf,previous={}){
 if(!validDay(asOf)||state.records<10000||state.customers.size<900||
   state.customers.size>5000||state.occurrences.length<10000||
   state.invoices.size<10000)
  throw Error("archive_data_incomplete_or_unrecognised");
 // A job transferred from an inactive account is valid. Simultaneous active
 // customer ownership is ambiguous and is NOT safe to score automatically.
 for(const owners of state.jobOwners.values()){
  if(owners.size<2)continue;
  let activeOwners=0;
  for(const customerId of owners.keys())
   if(state.customers.has(customerId))activeOwners++;
  if(activeOwners>1)throw Error("squeegee_job_shared_active_customers");
 }
 const rows=new Map();
 for(const [id,c] of state.customers){
  const account=makeCustomer(c,previous);
  // A zero/credit balance means all linked completed cleans are paid.
  // No transaction ledger means UNKNOWN, never automatically settled.
  const amount=state.balance.get(id);
  account.balanceState=!state.balance.has(id)||!Number.isFinite(amount)
   ?"unknown":amount>0.005?"outstanding":"settled";
  rows.set(id,account);
 }
 // A verified paid Squeegee job remains paid after a new invoice increases
 // the total account balance. Only an identical prior customer reference,
 // recurring job and cleaning date may preserve that earlier evidence.
 const previousPaid=new Map();
 for(const [id,account] of rows){
  const prior=previous?.[id];
  if(prior?.ref!==account.ref||!Array.isArray(prior.paidJobDays)||
     prior.paidJobDays.length>2500)continue;
  previousPaid.set(id,new Set(prior.paidJobDays.filter(x=>
   typeof x==="string"&&x.length<70)));
 }
 const events=new Map(),audit={paidBins:0,heldOccurrences:0,
  completedOccurrences:0,skippedOccurrences:0,unknownServices:0};
 for(const occ of state.occurrences){
  if(!rows.has(occ.customerId)||occ.date>asOf)continue;
  if(!events.has(occ.customerId))events.set(occ.customerId,[]);
  if(occ.status===2){
   audit.skippedOccurrences++;
   events.get(occ.customerId).push({...occ,kind:"skip",quantity:0});
   continue;
  }
  audit.completedOccurrences++;
  const qty=occ.services.reduce((s,item)=>s+quantityOf(item),0);
  if(qty>20)throw Error("review_oversized_service_quantity");
  const inv=state.invoices.get(occ.invoiceId);
  const linkedInvoice=inv?.customerId===occ.customerId&&!inv.deleted;
  const paid=linkedInvoice&&
   (rows.get(occ.customerId).balanceState==="settled"||
    previousPaid.get(occ.customerId)?.has(occ.jobId+":"+occ.date)||
    (occ.paymentStatus==="paid"&&occ.paidDate&&inv.paid)||
    (occ.paymentStatus==="invoiced"&&inv.paid===true));
  const kind=qty===0?"non-bin":paid?"paid":"unpaid";
  if(qty===0)audit.unknownServices++;
  if(kind==="paid")audit.paidBins+=qty;
  if(kind==="unpaid")audit.heldOccurrences++;
  events.get(occ.customerId).push({...occ,kind,quantity:qty});
 }
 for(const [id,list] of events){
  const row=rows.get(id);
  const jobs=new Map();
  for(const occurrence of list){
   if(!jobs.has(occurrence.jobId))jobs.set(occurrence.jobId,[]);
   jobs.get(occurrence.jobId).push(occurrence);
  }
  const orderedJobs=[...jobs.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
  const allEvents=[];
  for(let jobIndex=0;jobIndex<orderedJobs.length;jobIndex++){
   const [jobId,occurrences]=orderedJobs[jobIndex];
   occurrences.sort((a,b)=>a.date.localeCompare(b.date)||
    (a.kind==="skip"?-1:b.kind==="skip"?1:0)||a.id.localeCompare(b.id));
   let streak=0,lastVisitDay=null,jobPaidBins=0,jobPoints=0,jobSkips=0;
   let lastCompletedOn=null;
   const label=jobLabel(occurrences.flatMap(x=>x.services));
   for(const occ of occurrences){
    // Each unpaid cleaning occurrence has a stable ID. A positive balance
    // and verified unpaid invoice are both required before a penalty.
    const invoice=state.invoices.get(occ.invoiceId);
    if(occ.kind==="unpaid"&&row.balanceState==="outstanding"&&
       invoice?.customerId===id&&!invoice.deleted&&
       invoice.paid===false&&occ.paymentStatus==="invoiced"){
      row.outstandingJobs.push({id:occ.id,dueOn:occ.date,j:jobIndex});
    }
    // The backup retains the original Squeegee paidDate for late-paid
    // occurrences, even when today's account balance is £0. Rebuild
    // the full historical penalty, but only with a linked settled invoice.
    // Squeegee lets a payment settle many invoices on one later day.
    const paidOn=typeof occ.paidDate==="string"?occ.paidDate.slice(0,10):"";
    const paidDay=validDay(paidOn)?Date.parse(paidOn+"T00:00:00Z"):NaN;
    const cleanDay=Date.parse(occ.date+"T00:00:00Z");
    if(occ.kind==="paid"&&occ.paymentStatus==="paid"&&
       invoice?.customerId===id&&!invoice.deleted&&invoice.paid===true&&
       Number.isFinite(paidDay)&&paidOn<=asOf&&
       Number.isInteger((paidDay-cleanDay)/86400000)&&
       paidDay-cleanDay>28*86400000){
      row.settledJobs.push({id:occ.id,dueOn:occ.date,
       paidOn,j:jobIndex});
    }
    let event;
    if(occ.kind==="skip"){
     streak=0;lastVisitDay=null;jobSkips++;row.recordedSkips++;
     event={date:occ.date,event:"recorded_skip",
      streak:0,quantity:0,points:0,j:jobIndex};
    }else if(occ.kind==="non-bin"){
     event={date:occ.date,event:"completed_non_bin_service",
      streak,quantity:0,points:0,j:jobIndex};
    }else{
     if(occ.date!==lastVisitDay){
      streak++;lastVisitDay=occ.date;
     }
     lastCompletedOn=occ.date;
     const paid=occ.kind==="paid",qty=occ.quantity;
     const points=paid?qty*(20+2*(streak-1)):0;
     event={date:occ.date,event:paid?
      "paid_completed_clean":"completed_payment_not_verified",
      points,streak,quantity:qty,j:jobIndex};
     if(paid){
      row.points+=points;row.paidCleans+=qty;
      jobPoints+=points;jobPaidBins+=qty;
     }
    }
    allEvents.push({...event,_id:occ.id});
   }
   row.jobs.push({id:jobId,label,currentStreak:streak,
    nextBonus:20+2*streak,paidCleans:jobPaidBins,points:jobPoints,
    recordedSkips:jobSkips,lastCompletedOn});
  }
  allEvents.sort((a,b)=>a.date.localeCompare(b.date)||a.j-b.j||
   (a.event==="recorded_skip"?-1:b.event==="recorded_skip"?1:0)||
   a._id.localeCompare(b._id));
  row.events=allEvents.map(({_id,...e})=>e);
  // Legacy account-wide fields are retained for version-compatible readers,
  // but UI must display individual job streaks, never this maximum as a bonus.
  row.currentStreak=Math.max(0,...row.jobs.map(job=>job.currentStreak));
  row.nextBonus=20+2*row.currentStreak;
  if(row.events.length>2500)throw Error("unusual_history_needs_review");
 }
 const accounts=[...rows.values()].sort((a,b)=>a.id.localeCompare(b.id));
 const paidBins=accounts.reduce((t,a)=>t+a.paidCleans,0);
 if(paidBins!==audit.paidBins||paidBins<20000||paidBins>80000)
  throw Error("paid_bin_totals_need_review");
 if(asOf==="2026-11-06"&&paidBins!==26039)
  throw Error("known_6_nov_backup_mismatch");
 const points=accounts.reduce((t,a)=>t+a.points,0);
 if(points<=0)throw Error("scoring_not_ready");
 return {snapshot:{version:1,asOf,scoringVersion:SCORE_VERSION,
  penaltySourceVersion:PENALTY_SOURCE_VERSION,accounts},
  summary:{activeAccounts:accounts.length,verifiedPaidBins:paidBins,points,
   heldOccurrences:audit.heldOccurrences,
   unknownServices:audit.unknownServices}};
}
