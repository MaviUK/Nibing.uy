// Retired owner recovery for NBG-MVV99LDX-7BEDD59D85.
// Deliberately no imports, Squeegee API reads/writes, Blob claims, OTPs
// or live write operations. Previous booking and its audit remain immutable.
// A fresh, one-use normal Submit Booking pilot replaces this flow.
const HEADERS={
  "Content-Type":"text/html; charset=utf-8",
  "Cache-Control":"private, no-store, max-age=0",
  "X-Robots-Tag":"noindex,nofollow,noarchive",
  "X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer",
  "Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
};
export default async function handler(request,context) {
  const hostname=new URL(request.url).hostname;
  if(hostname!=="deploy-preview-77--nibinguy.netlify.app" ||
     context?.deploy?.context!=="deploy-preview" ||
     context?.site?.id!=="d63c829f-3ed7-48e9-9633-a042de3f2e84")
    return new Response("Not found",{status:404});
  const html='<!doctype html><html lang="en"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>Old test retired - NI Bin Guy</title>'+
    '<style>body{font:16px/1.5 system-ui;background:#111624;color:#fff;padding:16px}'+
    'main{max-width:540px;margin:32px auto;background:#252b3e;border:2px solid #f7dd52;padding:24px}'+
    'a{color:#f7dd52}</style></head><body><main>'+
    '<h1>Old Squeegee test retired</h1>'+
    '<p>The previous two-bin recovery has been closed. It will not create,'+
    ' retry, change or delete anything in Squeegee.</p>'+
    '<p>We are starting a <strong>fresh one-bin booking</strong> using the'+
    ' normal Submit Booking button. Do not resubmit the previous booking.</p>'+
    '<p><a href="/">Open Preview 1 booking form</a></p>'+
    '<p>Production and Preview 2 remain unchanged.</p>'+
    '</main></body></html>';
  return new Response(html,{status:410,headers:HEADERS});
}
export const config={
  path:"/api/squeegee-preview-auto-recover",
  rateLimit:{action:"rate_limit",aggregateBy:"ip",windowSize:60,windowLimit:10},
};
