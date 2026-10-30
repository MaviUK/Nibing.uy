// One-time schema probe: GET only; never returns actual customer information.
import api from "./lib/squeegeeApiV3.js";
const json=(status, body)=>new Response(JSON.stringify(body),{
  status,headers:{"content-type":"application/json","cache-control":"no-store",
  "x-content-type-options":"nosniff"},
});
const keys = x => x && typeof x==="object" ? Object.keys(x).slice(0,50) : [];
const shape = value => value===null ? "null" : Array.isArray(value) ? "array" : typeof value;
const nestedFields = obj => {
  if (!obj || typeof obj !== "object") return {};
  return Object.fromEntries(Object.entries(obj).slice(0,40).map(([k,v]) => [k,shape(v)]));
};

export default async function handler(req,context) {
  if(new URL(req.url).hostname!=="deploy-preview-77--nibinguy.netlify.app" ||
     context?.deploy?.context!=="deploy-preview" ||
     req.method!=="GET") return json(404,{error:"Not found"});
  try {
    const first=await api.listCustomers({page:1});
    const candidate=(first?.customers||[]).find(c=>c?._id &&
      Array.isArray(c.jobs) && c.jobs.length>0);
    if(!candidate) return json(200,{readOnly:true,found:false});
    const details=await api.getCustomer(candidate._id);
    const data=details?.customer || details;
    const jobs=Array.isArray(data?.jobs)?data.jobs:[];
    const firstJob=jobs[0]||null;
    const rawAppts=firstJob?.appointments||firstJob?.scheduledAppointments||
      data?.appointments||[];
    const firstAppointment=Array.isArray(rawAppts)?rawAppts[0]:rawAppts;
    return json(200,{
      readOnly:true,
      found:true,
      topLevelKeys:keys(details),
      topLevelFieldTypes:nestedFields(details),
      customerKeys:keys(data),
      customerJobArray:Array.isArray(data?.jobs),
      jobsCountInOneRecord:jobs.length,
      firstJobKeys:keys(firstJob),
      firstJobFieldTypes:nestedFields(firstJob),
      scheduleKeys:keys(firstJob?.schedule),
      scheduleFieldTypes:nestedFields(firstJob?.schedule),
      appointmentsType:shape(rawAppts),
      appointmentKeys:keys(firstAppointment),
    });
  } catch(e) {
    return json(502,{readOnly:true,found:false,error:"Unavailable",status:e?.status||null});
  }
}
