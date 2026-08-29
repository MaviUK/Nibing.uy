function normalizePostcode(value){const c=String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');if(c.length<5||c.length>7)return null;return `${c.slice(0,-3)} ${c.slice(-3)}`;}
function dec(v){return String(v||'').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');}
function strip(h){return dec(String(h||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/p>|<\/div>|<\/li>|<\/tr>|<\/h\d>/gi,'\n').replace(/<[^>]+>/g,' ')).replace(/[ \t]+/g,' ').replace(/\n\s*\n+/g,'\n').trim();}
function attr(tag,name){return tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:["']([^"']*)["']|([^\\s>]+))`,'i'))?.slice(1).find(Boolean)||'';}
function abs(h,b){try{return new URL(dec(h),b).href}catch{return null}}
function normalizeBin(v){const x=String(v||'BLACK').toUpperCase();return['BLACK','BLUE','BROWN'].includes(x)?x:'BLACK';}

function createCookieJar(){
 const jar=new Map();
 function absorb(headers){
  let values=[];
  if(typeof headers.getSetCookie==='function')values=headers.getSetCookie();
  if(!values.length){const raw=headers.get('set-cookie');if(raw)values=raw.split(/,(?=\s*[^;,]+=)/);}
  for(const line of values){const first=String(line||'').split(';')[0].trim();const eq=first.indexOf('=');if(eq>0)jar.set(first.slice(0,eq).trim(),first.slice(eq+1).trim());}
 }
 function header(){return [...jar.entries()].map(([k,v])=>`${k}=${v}`).join('; ');}
 return{absorb,header,size:()=>jar.size};
}

async function browserFetch(startUrl,options={},jar=createCookieJar()){
 let url=startUrl,method=String(options.method||'GET').toUpperCase(),body=options.body||undefined;
 const baseHeaders={
  'User-Agent':'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36',
  'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language':'en-GB,en;q=0.9',
  'Cache-Control':'no-cache',
  'Pragma':'no-cache',
  ...(options.headers||{})
 };
 let response=null;
 for(let hop=0;hop<8;hop++){
  const headers={...baseHeaders};const cookie=jar.header();if(cookie)headers.Cookie=cookie;
  response=await fetch(url,{method,body,headers,redirect:'manual'});jar.absorb(response.headers);
  if(![301,302,303,307,308].includes(response.status))break;
  const location=response.headers.get('location');if(!location)break;
  url=new URL(location,url).href;
  if(response.status===303||((response.status===301||response.status===302)&&method==='POST')){method='GET';body=undefined;delete baseHeaders['Content-Type'];delete baseHeaders['Origin'];}
  baseHeaders.Referer=response.url||startUrl;
 }
 const html=await response.text();
 return{response,html,url:response.url||url,jar};
}

function findPostcodeForm(html){const forms=[...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)].map(x=>x[0]);return forms.find(f=>/PostcodeBT/i.test(f)&&/PostcodeEND/i.test(f))||forms.find(f=>/postcode/i.test(f))||null;}
function parsePostcodeForm(form,base,pc1,pc2){
 const open=form.match(/<form\b[^>]*>/i)?.[0]||'';const action=abs(attr(open,'action')||base,base)||base,method=(attr(open,'method')||'POST').toUpperCase();const params=new URLSearchParams();let postcodeOption=null;
 for(const m of form.matchAll(/<input\b[^>]*>/gi)){const tag=m[0],name=attr(tag,'name');if(!name)continue;const type=(attr(tag,'type')||'text').toLowerCase(),value=attr(tag,'value');if(type==='hidden')params.set(name,value);else if(/PostcodeEND/i.test(name))params.set(name,pc2);else if(['checkbox','radio'].includes(type)&&/\bchecked\b/i.test(tag))params.append(name,value||'on');else if(type==='submit'&&value)params.set(name,value);}
 for(const sm of form.matchAll(/<select\b[^>]*>([\s\S]*?)<\/select>/gi)){const openTag=sm[0].match(/<select\b[^>]*>/i)?.[0]||'',name=attr(openTag,'name'),body=sm[1];if(!name)continue;for(const o of body.matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/gi)){const ot=o[0].match(/<option\b[^>]*>/i)?.[0]||'',value=attr(ot,'value'),label=strip(o[1]).trim();if((/PostcodeBT/i.test(name)||/BT\d{2}/i.test(label))&&(value.toUpperCase()===pc1||label.toUpperCase()===pc1)){postcodeOption={name,value:value||label,label};params.set(name,value||label);break;}}
 }
 params.set('PostcodeBT',postcodeOption?.value||pc1);params.set('PostcodeEND',pc2);
 return{action,method,params,postcodeOption};
}

function extractAddressChoices(html,base){const out=[],seen=new Set();function add(label,url){label=strip(label).replace(/\s+/g,' ').trim();url=abs(url,base);if(!label||!url)return;const key=label+'|'+url;if(seen.has(key))return;seen.add(key);out.push({label,url});}
 // Capture each View Schedule link and use the nearest postcode-bearing text before it.
 for(const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?View\s+Schedule[\s\S]*?<\/a>/gi)){const before=html.slice(Math.max(0,m.index-1200),m.index);const text=strip(before);const candidates=[...text.matchAll(/(?:^|\s)(\d+[A-Z]?(?:\s+[^\n]{0,100}?)?\s+BT\d{1,2}\s*\d[A-Z]{2})(?=\s|$)/gi)];add(candidates.at(-1)?.[1]||'',m[1]);}
 // Some templates wrap an address and button in a div/li rather than a clean anchor pairing.
 for(const block of html.matchAll(/<(?:div|li|article|section)\b[^>]*>[\s\S]{0,2500}?View\s+Schedule[\s\S]{0,500}?<\/(?:div|li|article|section)>/gi)){const b=block[0],href=b.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?View\s+Schedule/i)?.[1],text=strip(b),label=text.match(/(\d+[A-Z]?\s+.{1,120}?BT\d{1,2}\s*\d[A-Z]{2})/i)?.[1];if(href&&label)add(label,href);}
 return out.slice(0,150);}

function hasAddressResults(html){return /View\s+Schedule/i.test(html)&&/BT\d{1,2}\s*\d[A-Z]{2}/i.test(strip(html));}
function scoreResult(html,postcode){let s=0;if(hasAddressResults(html))s+=100;const t=strip(html).toUpperCase(),compact=postcode.replace(/\s/g,'');if(t.replace(/\s/g,'').includes(compact))s+=20;if(/CLICK ON ['’]?VIEW SCHEDULE/i.test(t))s+=30;if(/NO RESULTS|NO ADDRESS|NOT FOUND/i.test(t))s-=20;return s;}

async function submitPostcode(base,pc1,pc2,postcode){
 const jar=createCookieJar();const first=await browserFetch(base,{},jar);const form=findPostcodeForm(first.html);if(!form)throw new Error('Council postcode form was not found.');const parsed=parsePostcodeForm(form,first.url||base,pc1,pc2);
 const variants=[];function push(name,mutate){const p=new URLSearchParams(parsed.params);mutate?.(p);variants.push({name,params:p});}
 push('form_values');push('postback_1',p=>p.set('postback','1'));push('postback_true',p=>p.set('postback','true'));push('search_upper',p=>p.set('submit_btn','SEARCH'));push('search_title',p=>p.set('submit_btn','Search'));push('postback_1_search',p=>{p.set('postback','1');p.set('submit_btn','SEARCH');});
 const attempts=[];let best=null;
 for(const variant of variants){
  const localJar=createCookieJar(); // repeat the page load for a clean browser-like session each attempt
  const start=await browserFetch(base,{},localJar);const liveForm=findPostcodeForm(start.html);const liveParsed=liveForm?parsePostcodeForm(liveForm,start.url||base,pc1,pc2):parsed;for(const[k,v]of variant.params){if(!liveParsed.params.has(k)||['postback','submit_btn'].includes(k))liveParsed.params.set(k,v);}liveParsed.params.set('PostcodeBT',parsed.postcodeOption?.value||pc1);liveParsed.params.set('PostcodeEND',pc2);
  const headers={Referer:start.url||base,'Content-Type':'application/x-www-form-urlencoded',Origin:'https://www.newrymournedown.org'};
  let res;if(liveParsed.method==='GET'){const q=new URL(liveParsed.action);for(const[k,v]of liveParsed.params)q.searchParams.set(k,v);res=await browserFetch(q.href,{headers:{Referer:start.url||base}},localJar);}else res=await browserFetch(liveParsed.action,{method:'POST',headers,body:liveParsed.params.toString()},localJar);
  const score=scoreResult(res.html,postcode),choices=extractAddressChoices(res.html,res.url||liveParsed.action);const attempt={name:variant.name,status:res.response.status,score,addressCount:choices.length,hasViewSchedule:/View\s+Schedule/i.test(res.html),cookieCount:localJar.size(),finalUrl:res.url,submitted:Object.fromEntries(liveParsed.params.entries())};attempts.push(attempt);
  if(!best||score>best.score)best={score,html:res.html,url:res.url,choices,attempt};if(choices.length)break;
 }
 return{best,attempts,postcodeOption:parsed.postcodeOption};
}

function parseDates(text,wanted){const upper=String(text||'').toUpperCase(),aliases=wanted==='BLACK'?['BLACK BIN','BLACK']:wanted==='BLUE'?['BLUE BIN','BLUE','GREEN BIN','GREEN']:['BROWN BIN','BROWN'];let section=upper;for(const a of aliases){const i=upper.indexOf(a);if(i>=0){section=upper.slice(i,i+7000);break;}}const months={JANUARY:0,FEBRUARY:1,MARCH:2,APRIL:3,MAY:4,JUNE:5,JULY:6,AUGUST:7,SEPTEMBER:8,OCTOBER:9,NOVEMBER:10,DECEMBER:11},found=[];let m;const re=/\b(\d{1,2})(?:ST|ND|RD|TH)?\s+(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+(20\d{2})\b/g;while((m=re.exec(section)))found.push(new Date(Date.UTC(+m[3],months[m[2]],+m[1])).toISOString().slice(0,10));const slash=/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})\b/g;while((m=slash.exec(section)))found.push(new Date(Date.UTC(+m[3],+m[2]-1,+m[1])).toISOString().slice(0,10));const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),p=Object.fromEntries(parts.map(x=>[x.type,x.value])),today=`${p.year}-${p.month}-${p.day}`;return[...new Set(found)].filter(d=>d>=today).sort().slice(0,2);}

export default async function handler(req){try{const u=new URL(req.url),postcode=normalizePostcode(u.searchParams.get('postcode')),bin=normalizeBin(u.searchParams.get('bin')),scheduleUrl=u.searchParams.get('scheduleUrl');if(!postcode)return new Response(JSON.stringify({error:'Enter a valid Northern Ireland postcode.'}),{status:400,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});const base='https://www.newrymournedown.org/weekly-bin-collection-and-calendar';
 if(scheduleUrl){const target=abs(scheduleUrl,base);if(!target||new URL(target).hostname!=='www.newrymournedown.org')return new Response(JSON.stringify({error:'Invalid council schedule URL.'}),{status:400,headers:{'Content-Type':'application/json'}});const jar=createCookieJar();const res=await browserFetch(target,{},jar);const text=strip(res.html),dates=parseDates(text,bin);return new Response(JSON.stringify({matched:dates.length===2,stage:'schedule',postcode,bin,nextTwoCollectionDates:dates,source:res.url||target,note:dates.length===2?'Council schedule opened and two future dates were found.':'Schedule opened, but two future dates could not yet be parsed.',diagnostic:{status:res.response.status,cookieCount:jar.size(),textSample:text.slice(0,3000)}}),{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});}
 const compact=postcode.replace(/\s/g,''),pc1=compact.slice(0,-3),pc2=compact.slice(-3),result=await submitPostcode(base,pc1,pc2,postcode),choices=result.best?.choices||[];return new Response(JSON.stringify({matched:choices.length>0,stage:'addresses',postcode,bin,addresses:choices,source:result.best?.url||base,note:choices.length?'Council address list found. Select an address to open its schedule.':'Council responded, but the browser-style session still did not return address choices.',diagnostic:{postcodeOption:result.postcodeOption,bestAttempt:result.best?.attempt||null,attempts:result.attempts,textSample:strip(result.best?.html||'').slice(0,2500)}}),{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});}catch(e){return new Response(JSON.stringify({matched:false,error:e?.message||'NMD lookup failed'}),{status:502,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})}}