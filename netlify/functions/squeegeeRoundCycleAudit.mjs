// Temporary, GET-only Preview 1 acceptance probe for the owner's round cycle.
// No customer data, Squeegee UUIDs, API secrets, job writes or free-form input.
import squeegee from "./lib/squeegeeApiV3.js";
import cycle from "./lib/squeegeeRoundCycle.js";
const response=(status,data)=>new Response(JSON.stringify(data),{
  status,
  headers:{"content-type":"application/json","cache-control":"no-store","x-content-type-options":"nosniff"},
});
export default async function handler(req,ctx){
  if(new URL(req.url).hostname!=="deploy-preview-77--nibinguy.netlify.app" ||
     ctx?.deploy?.context!=="deploy-preview" || req.method!=="GET") {
    return response(404,{error:"Not found"});
  }
  if(!process.env.SQUEEGEE_API_KEY)return response(503,{readOnly:true,connected:false});
  try{
    const groups=await squeegee.getJobGroups();
    const days=[
      "2026-11-02","2026-11-03","2026-11-04","2026-11-05","2026-11-06",
      "2026-11-09","2026-11-13","2026-11-16","2026-11-20",
      "2026-11-23","2026-11-27","2026-11-30",
    ];
    const results=days.map(date=>{
      const a=cycle.resolveSqueegeeRoundJobGroup(date,groups,{recurring:true});
      return {date,week:a.weekNumber||null,round:a.roundNumber||null,status:a.status,
        mapped:Boolean(a.jobGroupId),holidayShift:Boolean(a.bankHolidayShifted)};
    });
    return response(200,{readOnly:true,connected:true,expectedWeeks:4,
      groupsAvailable:Array.isArray(groups)?groups.length:null,results});
  }catch(error){
    return response(502,{readOnly:true,connected:false,status:error?.status||null});
  }
}
