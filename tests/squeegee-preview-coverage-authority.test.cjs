"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {pathToFileURL} = require("node:url");

const root = path.resolve(__dirname,"..");
const read = (p) => fs.readFileSync(path.join(root,p),"utf8");
const loadPolicy = () => import(pathToFileURL(path.join(root,"src/serviceAreaPolicy.mjs")).href);
const townSchedule = JSON.parse(
  read("netlify/functions/data/townScheduleData.js")
    .replace(/^export default /,"").replace(/;\s*$/,"")
);

function postcodeFunction({rows=[],latitude=54.6608,longitude=-5.6680,addressesAvailable=true}={}) {
  const raw=read("netlify/functions/serviceAreaPostcode.js")
    .replace(/^import \{classifyCouncilAddresses\} from "\.\.\/\.\.\/src\/serviceAreaPolicy\.mjs";\n/,"")
    .replace("export default async function handler(req)",
      "async function handler(req)");
  return async (post) => {
    const policy=await loadPolicy();
    const observed=[];
    const fakeFetch=async (url) => {
      const target=String(url);observed.push(target);
      if(target.includes("api.postcodes.io/postcodes/"))
        return Response.json({result:{
          latitude,longitude,postcode:post.toUpperCase(),
        }});
      if(target.includes("binAddresses?")) {
        if(!addressesAvailable)return new Response("Unavailable",{status:503});
        return Response.json({data:{addresses:rows}});
      }
      throw new Error("Unexpected external lookup: "+target);
    };
    const fn=new Function("fetch","classifyCouncilAddresses","Response","URL","AbortSignal",
      raw+"\nreturn handler;")(fakeFetch,policy.classifyCouncilAddresses,Response,URL,AbortSignal);
    const response=await fn(new Request("https://deploy-preview-77--nibinguy.netlify.app"+
      "/.netlify/functions/serviceAreaPostcode?postcode="+encodeURIComponent(post)));
    return {response,body:await response.json(),observed};
  };
}
function bookingFunction({rows=[],html="GREY BIN 10 NOVEMBER 2026 BLUE BIN 12 NOVEMBER 2026 GREEN/BROWN BIN 11 NOVEMBER 2026",customSchedule=townSchedule}={}) {
  const source=read("netlify/functions/bookingSchedule.js")
    .replace(/^import townSchedule from "\.\/data\/townScheduleData\.js";\n/,"")
    .replace(/^import \{townFromAddress,areaStatusForTown\} from "\.\.\/\.\.\/src\/serviceAreaPolicy\.mjs";\n/,"")
    .replace("export default async function handler(req)","async function handler(req)")
    .replace('export const config={path:"/api/booking-schedule"};', "");
  return async (info={}) => {
    const policy=await loadPolicy();
    const observed=[];
    const fakeFetch=async (url)=>{
      const target=String(url);observed.push(target);
      if(target.includes("binAddresses?"))
        return Response.json({data:{addresses:rows}});
      if(target.includes("binLookup?"))
        return Response.json({addresses:[]});
      if(target.includes("binCalendar?"))
        return Response.json({html});
      throw new Error("Unexpected lookup: "+target);
    };
    const fn=new Function("townSchedule","townFromAddress","areaStatusForTown",
      "fetch","Response","URL",source+
      "\nreturn {handler,scheduledTownCount};")(
      customSchedule,policy.townFromAddress,policy.areaStatusForTown,
      fakeFetch,Response,URL);
    const request=new Request(
      "https://deploy-preview-77--nibinguy.netlify.app/api/booking-schedule",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({address:"17 Example Street, Bangor, BT20 4AA",
          postcode:"BT20 4AA",bins:[{type:"Black Bin"}],...info}),
      });
    const response=await fn.handler(request);
    return {status:response.status,body:await response.json(),
      observed,countFor:fn.scheduledTownCount};
  };
}
const bangor={uprn:"100001",addressText:"17 Example Street, Bangor, BT20 4AA"};
const millisle={uprn:"100002",addressText:"12 Bay Street, Millisle, BT22 2AA"};
const greyabbey={uprn:"100003",addressText:"12 Main Street, Greyabbey, BT22 2AA"};

test("authorised towns and retired towns come from one reviewed policy",async()=>{
  const policy=await loadPolicy();
  assert.equal(policy.areaStatusForTown("Bangor"),"active");
  assert.equal(policy.areaStatusForTown("Groomsport"),"active");
  assert.equal(policy.areaStatusForTown("Conlig"),"active");
  for(const town of ["Greyabbey","Ballywalter","Portavogie","Cloughey","Ballyhalbert"])
    assert.equal(policy.areaStatusForTown(town),"removed");
  for(const town of ["Millisle","Portaferry"])
    assert.equal(policy.areaStatusForTown(town),"review");
  assert.equal(policy.townFromAddress("7 Bangor Road, Comber, BT23 4AA"),"COMBER");
  assert.equal(policy.townFromAddress(bangor.addressText),"BANGOR");
  assert.equal(policy.matchesCouncilProperty(
    "17 Example Rd, Bangor BT20 4AA","17 Example Road, Bangor, BT20 4AA"),true);
  assert.equal(policy.matchesCouncilProperty("17 Wrong Road, Bangor","17 Example Road, Bangor"),false);
  assert.equal(policy.matchesCouncilProperty("Example Community Hall, Bangor, BT20 4AA",
    "Example Community Hall, Bangor, BT20 4AA"),true);
  assert.equal(policy.matchesCouncilProperty("Another Community Hall, Bangor, BT20 4AA",
    "Example Community Hall, Bangor, BT20 4AA"),false);
});

test("verified Bangor postcode needs actual active council-town evidence",async()=>{
  const {response,body,observed}=await postcodeFunction({rows:[bangor]})("BT20 4AA");
  assert.equal(response.status,200);
  assert.equal(body.valid,true);
  assert.equal(body.covered,true);
  assert.equal(body.town,"BANGOR");
  assert.equal(body.addresses[0].status,"active");
  assert.match(observed.find(x=>x.includes("binAddresses?")),/BT20%204AA/);
  assert.match(response.headers.get("Netlify-CDN-Cache-Control"),/600/);
});

test("a mixed active and uncertain postcode requires property selection, not blanket approval",async()=>{
  const {body}=await postcodeFunction({rows:[bangor,millisle]})("BT20 4AA");
  assert.equal(body.covered,false);
  assert.equal(body.possible,true);
  assert.equal(body.reason,"select_address_for_confirmation");
  assert.deepEqual(body.addresses.map(x=>x.status),["active","review"]);
});

test("removed or unverified council towns cannot become covered just by being nearby",async()=>{
  const removed=await postcodeFunction({rows:[greyabbey]})("BT22 2AA");
  assert.equal(removed.body.covered,false);
  assert.equal(removed.body.possible,false);
  const unknown=await postcodeFunction({addressesAvailable:false})("BT20 4AA");
  assert.equal(unknown.body.covered,false);
  assert.equal(unknown.body.possible,true);
  assert.equal(unknown.body.reason,"council_address_lookup_unavailable");
});

test("outward-zone postcode with legitimate council address goes for review instead of false denial",async()=>{
  const result=await postcodeFunction({rows:[bangor],
    latitude:54.1,longitude:-6.3})("BT20 4AA");
  assert.equal(result.body.covered,false);
  assert.equal(result.body.possible,true);
  assert.equal(result.body.reason,"postcode_edge_requires_review");
});

test("booking date uses the exact council property and preserves its town",async()=>{
  const result=await bookingFunction({rows:[bangor]})();
  assert.equal(result.status,200);
  assert.equal(result.body.town,"BANGOR");
  assert.equal(result.body.townSource,"matched_council_address");
  assert.equal(result.body.councilAddress,bangor.addressText);
  assert.equal(result.body.results[0].assignedCleanDate,"2026-11-10");
  assert.equal(result.body.results[0].automatic,true);
  assert.equal(result.body.matched,true);
  assert.equal(result.observed.filter(x=>x.includes("binCalendar?")).length,1);
});

test("the exact council UPRN address is valid even without a numbered property",async()=>{
  const townHall={uprn:"100020",addressText:"Example Community Hall, Bangor, BT20 4AA"};
  const result=await bookingFunction({rows:[townHall]})({
    address:townHall.addressText,
  });
  assert.equal(result.status,200);
  assert.equal(result.body.addressMatchMethod,"exact_council_address");
  assert.equal(result.body.town,"BANGOR");
  assert.equal(result.body.matched,true);
  assert.equal(result.body.results[0].automatic,true);
});

test("same house number and postcode but WRONG street never fetches a calendar",async()=>{
  const result=await bookingFunction({rows:[bangor]})({
    address:"17 Other Street, Bangor, BT20 4AA",
  });
  assert.equal(result.body.matched,false);
  assert.equal(result.body.reason,"council_address_ambiguous");
  assert.equal(result.observed.some(x=>x.includes("binCalendar?")),false);
});

test("postcode mismatches return To be confirmed and cannot allocate someone else's date",async()=>{
  const result=await bookingFunction({rows:[bangor]})({
    address:"17 Example Street, Bangor BT21 3AA",postcode:"BT20 4AA",
  });
  assert.equal(result.body.matched,false);
  assert.equal(result.body.reason,"address_postcode_mismatch");
  assert.equal(result.observed.length,0);
});

test("typed town cannot override verified council town to borrow another town's rota",async()=>{
  const result=await bookingFunction({rows:[bangor]})({
    address:"17 Example Street, Millisle, BT20 4AA",
  });
  assert.equal(result.body.matched,false);
  assert.equal(result.body.reason,"address_town_mismatch");
  assert.equal(result.observed.some(x=>x.includes("binCalendar?")),false);
});

test("retired historical towns are always held, even with old round dates in export",async()=>{
  const result=await bookingFunction({rows:[greyabbey]})({
    address:"12 Main Street, Greyabbey, BT22 2AA",postcode:"BT22 2AA",
  });
  assert.equal(result.body.reason,"service_area_not_covered");
  assert.equal(result.body.matched,false);
  assert.equal(result.observed.some(x=>x.includes("binCalendar?")),false);
});

test("an unconfirmed local town is held rather than automatically scheduled",async()=>{
  const result=await bookingFunction({rows:[millisle]})({
    address:"12 Bay Street, Millisle, BT22 2AA",postcode:"BT22 2AA",
  });
  assert.equal(result.body.reason,"service_area_requires_confirmation");
  assert.equal(result.body.matched,false);
  assert.equal(result.observed.some(x=>x.includes("binCalendar?")),false);
});

test("ordinary Friday routes stay disabled, but bank-holiday Thursday shifts may land Friday",async()=>{
  const ordinary=await bookingFunction({rows:[bangor]})();
  assert.equal(ordinary.countFor("BANGOR","2026-11-06"),0);
  const holiday=await bookingFunction({rows:[bangor],
    customSchedule:{BANGOR:[["2027-05-06",4,1]]}})();
  assert.equal(holiday.countFor("BANGOR","2027-05-07"),1);
});

test("frontend retains the full council address dropdown with square N64 visuals; removed areas do not autobook",()=>{
  const coverage=read("src/CoverageChecker.jsx");
  const guard=read("src/serviceAreaGuard.js");
  const worker=read("netlify/functions/lib/squeegeeScheduleCheck.js");
  assert.match(coverage,/areaStatusForTown\(selectedTown\)==="active"/);
  assert.match(coverage,/data\.covered !== true && data\.possible !== true/);
  assert.match(coverage,/await findAddresses\(pc, sequence, controller\.signal, data\.addresses\)/);
  assert.match(coverage,/disabled=\{!selectedActive\}/);
  assert.match(coverage,/if\(!selectedActive\)return/);
  assert.match(coverage,/LEVEL 03/);
  assert.doesNotMatch(coverage,/home-coverage-address-search/);
  assert.doesNotMatch(coverage,/matching addresses shown/);
  assert.doesNotMatch(coverage,/filterAddresses\(/);
  assert.match(coverage,/const sortedAddresses=\[\.\.\.addresses\]\.sort\(/);
  assert.match(coverage,/addressCollator\.compare\(a\.label,b\.label\)/);
  assert.match(coverage,/sortedAddresses\.map\(\(address\) =>/);
  assert.doesNotMatch(coverage,/rounded-xl|rounded-lg|rounded-2xl/);
  assert.doesNotMatch(coverage,/Yes! We cover/);
  assert.match(guard,/matchesCouncilProperty\(address,row\.label\)/);
  assert.match(guard,/submit booking\|send via email\|send via whatsapp/);
  assert.doesNotMatch(guard,/return finishCovered\(root, address, postcode, townInText/);
  assert.match(worker,/activeTowns.*activeServiceAreas/);
});
