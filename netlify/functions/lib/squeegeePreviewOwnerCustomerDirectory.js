"use strict";
// Private Preview 77 directory helpers. These never authorise a request:
// the Netlify entrypoint must verify the owner's signed session first.
function yearOf(value) {
  const year=Number(value);
  return Number.isInteger(year)&&year>=2000&&year<=2099?year:null;
}
function cleaningSummary(account,year=null) {
  let points=0,paidBins=0,paidVisits=0,unverified=0,skips=0,nonBin=0;
  for(const event of Array.isArray(account?.events)?account.events:[]) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(event?.date||"")))continue;
    if(year!==null && Number(event.date.slice(0,4))!==year)continue;
    const quantity=Number.isSafeInteger(event.quantity)&&event.quantity>0
      ?event.quantity:1; // v1 pre-per-bin history records one paid clean per event.
    if(event.event==="paid_completed_clean") {
      points+=Number.isSafeInteger(event.points)?event.points:0;
      paidBins+=quantity;
      paidVisits++;
    }else if(event.event==="completed_payment_not_verified")unverified++;
    else if(event.event==="recorded_skip")skips++;
    else if(event.event==="completed_non_bin_service")nonBin++;
  }
  return {points,paidBins,paidVisits,unverified,skips,nonBin};
}
function directoryRows(accounts,{query="",mode="all",year=null,eligibleAliases=new Set(),
  aliasForId=()=>null}={}) {
  const q=String(query||"").trim().toLocaleLowerCase("en-GB").slice(0,90);
  const rows=[];
  for(const account of Array.isArray(accounts)?accounts:[]) {
    if(typeof account?.id!=="string"||typeof account.ref!=="string")continue;
    const alias=aliasForId(account.id);
    const eligible=typeof alias==="string"&&eligibleAliases.has(alias);
    if(mode==="eligible"&&!eligible)continue;
    if(mode==="other"&&eligible)continue;
    if(q && ![account.firstName,account.town,account.email,account.ref]
      .some(value=>String(value||"").toLocaleLowerCase("en-GB").includes(q)))continue;
    const current=cleaningSummary(account,year);
    if(year!==null&&current.points===0&&current.paidVisits===0&&current.unverified===0&&current.skips===0)continue;
    rows.push({account,eligible,periodPoints:current.points,
      periodBins:current.paidBins,overallPoints:Number(account.points)||0});
  }
  rows.sort((a,b)=>b.periodPoints-a.periodPoints||
    b.overallPoints-a.overallPoints||a.account.ref.localeCompare(b.account.ref));
  return rows;
}
function yearlyCleaning(account) {
  const years=new Set();
  for(const event of Array.isArray(account?.events)?account.events:[]){
    const date=String(event?.date||"");
    if(/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const year=yearOf(date.slice(0,4));
      if(year)years.add(year);
    }
  }
  return [...years].sort((a,b)=>b-a).map(year=>({
    year,...cleaningSummary(account,year)
  }));
}
module.exports={yearOf,cleaningSummary,directoryRows,yearlyCleaning};
