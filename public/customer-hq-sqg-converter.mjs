// Runs in the owner's browser. The complete .sqg never leaves their device.
export const SCORE_VERSION="2026-11-streak-20-plus-2-per-paid-bin-v1";
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
export function makeState() {
 return {customers:new Map(),invoices:new Map(),balance:new Map(),
  occurrences:[],records:0,types:new Map()};
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
  const services=(row.services||[]).map(s=>({
    description:String(s?.description||""),quantity:s?.quantity}));
  state.occurrences.push({id:String(row._id||""),
   customerId:row.customerId.toLowerCase(),date,status:row.status,services,
   invoiceId:String(row.invoiceTransactionId||"").toLowerCase(),
   paymentStatus:row.paymentStatus,paidDate:row.paidDate||null});
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
  recordedSkips:0,events:[]};
}
export function finishSqueegeeImport(state,asOf,previous={}){
 if(!validDay(asOf)||state.records<10000||state.customers.size<900||
   state.customers.size>5000||state.occurrences.length<10000||
   state.invoices.size<10000)
  throw Error("archive_data_incomplete_or_unrecognised");
 const rows=new Map();
 for(const [id,c] of state.customers)rows.set(id,makeCustomer(c,previous));
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
  const paid=inv?.customerId===occ.customerId&&!inv.deleted&&
   ((occ.paymentStatus==="paid"&&occ.paidDate&&inv.paid)||
     (occ.paymentStatus==="invoiced"&&(state.balance.get(occ.customerId)||0)<0.005));
  const kind=qty===0?"non-bin":paid?"paid":"unpaid";
  if(qty===0)audit.unknownServices++;
  if(kind==="paid")audit.paidBins+=qty;
  if(kind==="unpaid")audit.heldOccurrences++;
  events.get(occ.customerId).push({...occ,kind,quantity:qty});
 }
 for(const [id,list] of events){
  const row=rows.get(id);
  list.sort((a,b)=>a.date.localeCompare(b.date)||
    (a.kind==="skip"?-1:b.kind==="skip"?1:0)||
    a.id.localeCompare(b.id));
  let streak=0,lastVisitDay=null;
  for(const occ of list){
   if(occ.kind==="skip"){
    streak=0;lastVisitDay=null;row.recordedSkips++;
    row.events.push({date:occ.date,event:"recorded_skip",
     streak:0,quantity:0,points:0});
    continue;
   }
   if(occ.kind==="non-bin"){
    row.events.push({date:occ.date,event:"completed_non_bin_service",
     streak,quantity:0,points:0});
    continue;
   }
   if(occ.date!==lastVisitDay){streak++;lastVisitDay=occ.date;}
   const paid=occ.kind==="paid",qty=occ.quantity;
   const points=paid?qty*(20+2*(streak-1)):0;
   row.events.push({date:occ.date,
    event:paid?"paid_completed_clean":"completed_payment_not_verified",
    points,streak,quantity:qty});
   if(paid){row.points+=points;row.paidCleans+=qty;}
  }
  row.currentStreak=streak;row.nextBonus=20+2*streak;
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
 return {snapshot:{version:1,asOf,scoringVersion:SCORE_VERSION,accounts},
  summary:{activeAccounts:accounts.length,verifiedPaidBins:paidBins,points,
   heldOccurrences:audit.heldOccurrences,
   unknownServices:audit.unknownServices}};
}
