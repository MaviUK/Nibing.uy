import townSchedule from "./data/townScheduleData.js";

function normalizePostcode(value) {
  const compact = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function normAddress(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/\bNORTHERN IRELAND\b/g, "")
    .replace(/[.,'’]/g, " ")
    .replace(/\bRD\b/g, "ROAD")
    .replace(/\bST\b/g, "STREET")
    .replace(/\bAVE\b/g, "AVENUE")
    .replace(/\s+/g, " ")
    .trim();
}

function propertyNumber(value) {
  return String(value || "").trim().toUpperCase().match(/^(\d+[A-Z]?)(?:\b|\s)/)?.[1] || "";
}

function addressScore(wanted, candidate) {
  const a = normAddress(wanted);
  const b = normAddress(candidate);
  if (a === b) return 100;
  const house = a.match(/^\d+[A-Z]?\b/)?.[0];
  let score = house && b.match(new RegExp(`^${house}\\b`)) ? 25 : 0;
  const postcodeToken = a.match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i)?.[0]?.replace(/\s/g, "");
  const generic = new Set(["ROAD", "STREET", "AVENUE", "DRIVE", "LANE", "PARK", "GARDENS", "CRESCENT", "COURT", "CLOSE", "GROVE", "PLACE", "SQUARE", "THE"]);
  const tokens = a.split(" ").filter((t) => t.length > 2 && !generic.has(t) && t.replace(/\s/g, "") !== postcodeToken);
  score += tokens.filter((t) => b.includes(t)).length * 5;
  return score;
}

function normalizeBin(value) {
  const s = String(value || "").toUpperCase();
  if (s.includes("BLACK") || s.includes("GREY") || s.includes("GRAY")) return "GREY";
  if (s.includes("BLUE")) return "BLUE";
  if (s.includes("BROWN") || s.includes("GREEN")) return "GREEN/BROWN";
  return s;
}

function parseCouncilDates(html, wantedBin) {
  const text = stripHtml(html).toUpperCase();
  const aliases = wantedBin === "GREY" ? ["GREY BIN", "GRAY BIN", "BLACK BIN"] : wantedBin === "BLUE" ? ["BLUE BIN"] : ["GREEN/BROWN BIN", "GREEN BROWN BIN", "BROWN BIN", "GREEN BIN"];
  const allHeadings = ["GREY BIN", "GRAY BIN", "BLACK BIN", "BLUE BIN", "GREEN/BROWN BIN", "GREEN BROWN BIN", "BROWN BIN", "GREEN BIN", "GLASS COLLECTION BOX", "GLASS BOX", "TRADE"];
  const mn = { JAN:0,JANUARY:0,FEB:1,FEBRUARY:1,MAR:2,MARCH:2,APR:3,APRIL:3,MAY:4,JUN:5,JUNE:5,JUL:6,JULY:6,AUG:7,AUGUST:7,SEP:8,SEPT:8,SEPTEMBER:8,OCT:9,OCTOBER:9,NOV:10,NOVEMBER:10,DEC:11,DECEMBER:11 };
  const weekdayNumber = { SUN:0,SUNDAY:0,MON:1,MONDAY:1,TUE:2,TUES:2,TUESDAY:2,WED:3,WEDNESDAY:3,THU:4,THUR:4,THURS:4,THURSDAY:4,FRI:5,FRIDAY:5,SAT:6,SATURDAY:6 };
  const lr = /\b(\d{1,2})\s+(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+(20\d{2})\b/g;
  const sr = /\b(?:MON|TUE|TUES|WED|THU|THUR|THURS|FRI|SAT|SUN)\s+(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)(?:\s+(20\d{2}))?\b/g;
  const now = new Date();

  function ukToday() {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
  }

  function makeDate(d,m,y){ const mo=mn[m]; if(mo==null)return null; let yr=y?Number(y):now.getUTCFullYear(); let dt=new Date(Date.UTC(yr,mo,Number(d))); if(!y&&dt.getTime()<now.getTime()-120*86400000){yr+=1;dt=new Date(Date.UTC(yr,mo,Number(d)));} return dt; }
  function nextAlternateDate(firstDate,targetWeekday){ const approx=new Date(firstDate.getTime()+14*86400000); if(!Number.isInteger(targetWeekday))return approx; const currentWeekday=approx.getUTCDay(); let shift=targetWeekday-currentWeekday; if(shift>3)shift-=7;if(shift<-3)shift+=7; const adjusted=new Date(approx.getTime()+shift*86400000); return adjusted.getTime()>firstDate.getTime()?adjusted:approx; }
  function findSection(alias){ let start=text.indexOf(alias);if(start<0)return "";start+=alias.length;let end=text.length;for(const heading of allHeadings){const pos=text.indexOf(heading,start);if(pos>=0&&pos<end)end=pos;}return text.slice(start,end); }

  for(const alias of aliases){
    const section=findSection(alias);
    if(!section)continue;
    const found=[];
    let match;
    const today = ukToday();
    if (/\bTODAY\b/.test(section)) found.push(new Date(today.getTime()));
    if (/\bTOMORROW\b/.test(section)) found.push(new Date(today.getTime() + 86400000));
    lr.lastIndex=0;
    while((match=lr.exec(section))){const date=makeDate(match[1],match[2],match[3]);if(date)found.push(date);}
    sr.lastIndex=0;
    while((match=sr.exec(section))){const date=makeDate(match[1],match[2],match[3]);if(date)found.push(date);}
    const unique=[...new Map(found.map((date)=>[date.toISOString().slice(0,10),date])).values()].sort((a,b)=>a.getTime()-b.getTime());
    if(!unique.length)continue;
    const first=unique[0];
    const dates=[first];
    if(unique.length>1){dates.push(unique[1]);}else{
      const recurrence=section.match(/EVERY\s+ALTERNATE\s+(MON(?:DAY)?|TUE(?:S|SDAY)?|WED(?:NESDAY)?|THU(?:R|RS|RSDAY)?|FRI(?:DAY)?|SAT(?:URDAY)?|SUN(?:DAY)?)/i);
      if(recurrence){const key=recurrence[1].toUpperCase();const targetWeekday=weekdayNumber[key]??weekdayNumber[key.slice(0,3)];dates.push(nextAlternateDate(first,targetWeekday));}
    }
    return [...new Set(dates.map((date)=>date.toISOString().slice(0,10)))].sort();
  }
  return [];
}

const DAY_MS=86400000;
function ukBookingCutoff() {
  const parts = new Intl.DateTimeFormat("en-GB", {timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hourCycle:"h23"}).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part)=>[part.type,part.value]));
  return {date:`${values.year}-${values.month}-${values.day}`,afterCutoff:Number(values.hour)>=10};
}
function nextTwoCouncilDates(councilDates){const cutoff=ukBookingCutoff();return(Array.isArray(councilDates)?councilDates:[]).filter((date)=>{const t=new Date(`${date}T12:00:00Z`).getTime();if(!Number.isFinite(t))return false;if(date<cutoff.date)return false;if(date===cutoff.date&&cutoff.afterCutoff)return false;return true;}).sort().slice(0,2);}
function normalizeTown(value){return String(value||"").toUpperCase().replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b.*$/i,"").replace(/\b[A-Z]{1,2}\d[A-Z\d]?\b.*$/i,"").replace(/\s+/g," ").trim();}
function extractTown(address){const parts=String(address||"").split(",").map((part)=>part.trim()).filter(Boolean);return parts.length>=2?normalizeTown(parts[1]):"";}
function inferTownFromPostcodeAddresses(addresses){const counts=new Map();for(const item of addresses||[]){const town=extractTown(item?.label);if(!town)continue;counts.set(town,(counts.get(town)||0)+1);}return [...counts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||"";}

function easterSundayUtc(year){
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),month=Math.floor((h+l-7*m+114)/31),day=((h+l-7*m+114)%31)+1;
  return new Date(Date.UTC(year,month-1,day));
}
function nthWeekdayUtc(year,month,weekday,n){const first=new Date(Date.UTC(year,month,1));const offset=(weekday-first.getUTCDay()+7)%7;return new Date(Date.UTC(year,month,1+offset+(n-1)*7));}
function lastWeekdayUtc(year,month,weekday){const last=new Date(Date.UTC(year,month+1,0));const offset=(last.getUTCDay()-weekday+7)%7;return new Date(Date.UTC(year,month,last.getUTCDate()-offset));}
function observedFixedUtc(year,month,day){const d=new Date(Date.UTC(year,month,day));if(d.getUTCDay()===6)return new Date(d.getTime()+2*DAY_MS);if(d.getUTCDay()===0)return new Date(d.getTime()+DAY_MS);return d;}
function isNorthernIrelandMondayBankHoliday(monday){
  if(!(monday instanceof Date)||monday.getUTCDay()!==1)return false;
  const year=monday.getUTCFullYear();
  const key=monday.toISOString().slice(0,10);
  const holidays=[];
  holidays.push(observedFixedUtc(year,0,1));
  holidays.push(observedFixedUtc(year,2,17));
  holidays.push(new Date(easterSundayUtc(year).getTime()+DAY_MS));
  holidays.push(nthWeekdayUtc(year,4,1,1));
  holidays.push(lastWeekdayUtc(year,4,1));
  holidays.push(observedFixedUtc(year,6,12));
  holidays.push(lastWeekdayUtc(year,7,1));
  // Christmas/Boxing Day substitute Mondays are deliberately excluded.
  // The council operates its Monday collection on those substitute dates,
  // so NI Bin Guy's Squeegee rounds must remain on their normal weekdays.
  return holidays.some((d)=>d.getUTCDay()===1&&d.toISOString().slice(0,10)===key);
}
function mondayOfWeekUtc(date){const d=new Date(date.getTime());const day=d.getUTCDay();const diff=day===0?-6:1-day;return new Date(d.getTime()+diff*DAY_MS);}
function scheduledTownCount(town,date){
  const rows=townSchedule[normalizeTown(town)]||[];
  const targetDate=new Date(`${date}T12:00:00Z`);
  const target=targetDate.getTime();
  if(!Number.isFinite(target))return 0;
  const weekMonday=mondayOfWeekUtc(targetDate);
  const bankHolidayShift=isNorthernIrelandMondayBankHoliday(weekMonday);
  const scheduledTarget=bankHolidayShift?target-DAY_MS:target;
  const scheduledDate=new Date(scheduledTarget);
  const scheduledWeekday=scheduledDate.getUTCDay();
  if(bankHolidayShift&&(targetDate.getUTCDay()<2||targetDate.getUTCDay()>5||scheduledWeekday<1||scheduledWeekday>4))return 0;
  let total=0;
  for(const [anchorDate,frequencyWeeks,support] of rows){
    const anchor=new Date(`${anchorDate}T12:00:00Z`).getTime();
    const period=Math.max(1,Number(frequencyWeeks)||4)*7*DAY_MS;
    if(!Number.isFinite(anchor)||scheduledTarget<anchor)continue;
    if((scheduledTarget-anchor)%period===0)total+=Math.max(1,Number(support)||1);
  }
  return total;
}
function chooseTownWorkloadMatch(town,councilDates){const nextTwo=nextTwoCouncilDates(councilDates);if(!town||!nextTwo.length)return null;const scoredDates=nextTwo.map((date)=>({date,support:scheduledTownCount(town,date)}));const viable=scoredDates.filter((item)=>item.support>0).sort((a,b)=>(b.support-a.support)||a.date.localeCompare(b.date));if(!viable.length)return null;const winner=viable[0];return{round:{matched:true,ambiguous:false,resolvedBy:"exact_town_workload_on_next_two_council_dates",town:normalizeTown(town),nextCleanDate:winner.date,councilValidationDate:winner.date,support:winner.support,townDateSupport:scoredDates},assignedCleanDate:winner.date,checkedCouncilDates:nextTwo};}
function normalizeAddressList(payload){let list=payload?.data?.addresses;if(!Array.isArray(list)&&Array.isArray(payload?.addresses))list=payload.addresses;if(!Array.isArray(list)&&payload?.addresses&&typeof payload.addresses==="object")list=Object.values(payload.addresses);return(list||[]).map((item)=>{if(!item||typeof item!=="object")return null;const uprn=String(item.uprn||item.UPRN||"").trim();const label=String(item.addressText||item.address||item.label||"").trim();return uprn&&label?{uprn,label}:null;}).filter(Boolean);}
async function getCouncilAddresses(origin,postcode){const directRes=await fetch(new URL(`/.netlify/functions/binAddresses?postcode=${encodeURIComponent(postcode)}`,origin));const directData=await directRes.json().catch(()=>({}));const directAddresses=directRes.ok?normalizeAddressList(directData):[];if(directAddresses.length)return{source:"binAddresses",addresses:directAddresses};const fallbackRes=await fetch(new URL(`/.netlify/functions/binLookup?postcode=${encodeURIComponent(postcode)}`,origin));const fallbackData=await fallbackRes.json().catch(()=>({}));const fallbackAddresses=Array.isArray(fallbackData.addresses)?fallbackData.addresses.map((i)=>({uprn:String(i.uprn||"").trim(),label:String(i.label||"").trim()})).filter((i)=>i.uprn&&i.label):[];return{source:"binLookup",addresses:fallbackRes.ok?fallbackAddresses:[]};}

export default async function handler(req){
 try{
  const body=req.method==="POST"?await req.json():{};const url=new URL(req.url);const address=String(body.address||url.searchParams.get("address")||"").trim();const postcode=normalizePostcode(body.postcode||url.searchParams.get("postcode")||address.match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i)?.[0]);const bins=(Array.isArray(body.bins)?body.bins:[url.searchParams.get("bin")]).filter(Boolean);
  if(!address||!postcode||!bins.length)return new Response(JSON.stringify({error:"address, postcode and bins are required"}),{status:400,headers:{"Content-Type":"application/json"}});
  const origin=new URL(req.url).origin;const councilAddressLookup=await getCouncilAddresses(origin,postcode);
  if(!councilAddressLookup.addresses.length)return new Response(JSON.stringify({matched:false,reason:"council_address_not_found",postcode,addressSource:councilAddressLookup.source}),{status:200,headers:{"Content-Type":"application/json"}});
  const requestedNumber=propertyNumber(address);
  const numberMatches=requestedNumber?councilAddressLookup.addresses.filter((candidate)=>propertyNumber(candidate.label)===requestedNumber):[];
  let ranked=[];let chosen=null;let confidentMatch=false;let addressMatchMethod="fuzzy_address";
  if(numberMatches.length===1){chosen={...numberMatches[0],score:100};ranked=[chosen];confidentMatch=true;addressMatchMethod="house_number_plus_postcode";}else{
    const pool=numberMatches.length>1?numberMatches:councilAddressLookup.addresses;ranked=pool.map((candidate)=>({...candidate,score:addressScore(address,candidate.label)})).sort((a,b)=>b.score-a.score);chosen=ranked[0];const runnerUp=ranked[1];confidentMatch=Boolean(chosen&&(chosen.score>=20||(chosen.score>=5&&(!runnerUp||chosen.score>runnerUp.score))));addressMatchMethod=numberMatches.length>1?"house_number_postcode_then_street_tiebreak":"fuzzy_address";
  }
  if(!confidentMatch)return new Response(JSON.stringify({matched:false,reason:"council_address_ambiguous",postcode,addressSource:councilAddressLookup.source,requestedPropertyNumber:requestedNumber,addressMatchMethod,candidates:ranked.slice(0,5)}),{status:200,headers:{"Content-Type":"application/json"}});
  const calRes=await fetch(new URL(`/.netlify/functions/binCalendar?uprn=${encodeURIComponent(chosen.uprn)}`,origin));const calData=await calRes.json().catch(()=>({}));
  if(!calRes.ok||!calData.html)return new Response(JSON.stringify({matched:false,reason:"council_calendar_failed",addressSource:councilAddressLookup.source,councilAddress:chosen.label,uprn:chosen.uprn}),{status:200,headers:{"Content-Type":"application/json"}});
  const postcodeTown=inferTownFromPostcodeAddresses(councilAddressLookup.addresses);const enteredTown=extractTown(address);const operationalTown=(enteredTown&&townSchedule[enteredTown])?enteredTown:"";const councilTown=extractTown(chosen.label);const town=operationalTown||councilTown||postcodeTown||enteredTown;const results=[];
  for(const bin of bins){const binName=bin.type||bin;const councilBin=normalizeBin(binName);const councilDates=parseCouncilDates(calData.html,councilBin);const nextTwo=nextTwoCouncilDates(councilDates);const resolved=chooseTownWorkloadMatch(town,councilDates);const assigned=resolved?.assignedCleanDate||null;results.push({bin:binName,councilBin,councilDates,nextTwoCouncilDates:nextTwo,town,round:resolved?.round||{matched:false,resolvedBy:"no_exact_town_work_on_next_two_council_dates",town,townDateSupport:nextTwo.map((date)=>({date,support:scheduledTownCount(town,date)}))},assignedCleanDate:assigned,automatic:Boolean(assigned)});}
  const townSource=operationalTown?"entered_operational_town":councilTown?"matched_council_address":"postcode_council_addresses";
  return new Response(JSON.stringify({matched:results.every((r)=>r.automatic),postcode,addressSource:councilAddressLookup.source,addressMatchMethod,requestedPropertyNumber:requestedNumber,councilAddress:chosen.label,town,townSource,uprn:chosen.uprn,results}),{headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
 }catch(error){return new Response(JSON.stringify({error:error?.message||"Booking schedule failed"}),{status:500,headers:{"Content-Type":"application/json"}});}
}
export const config={path:"/api/booking-schedule"};