"use strict";
import crypto from "node:crypto";
import zlib from "node:zlib";
import {getStore} from "@netlify/blobs";
import api from "./lib/squeegeeApiV3.js";
import hq from "./lib/customerHQ.js";
import binHistory from "./lib/squeegeePreviewBinHistory.js";
import annual from "./lib/squeegeeYearlyPreviewBoard.js";
import historical from "./lib/squeegeeActiveLeaderboardImport.js";
import records from "./lib/squeegeePreviewOwnerAchievements.js";

const REF="CUS52250834";
const KEY="preview77-email-leaderboard-v1";
const WIDTH=680,HEIGHT=955;
const C={black:[10,12,14],panel:[33,36,39],white:[255,255,255],yellow:[255,212,0],green:[13,108,68],muted:[204,209,208],grey:[240,242,241]};
const FONT={
"A":["01110","10001","10001","11111","10001","10001","10001"],
"B":["11110","10001","10001","11110","10001","10001","11110"],
"C":["01111","10000","10000","10000","10000","10000","01111"],
"D":["11110","10001","10001","10001","10001","10001","11110"],
"E":["11111","10000","10000","11110","10000","10000","11111"],
"F":["11111","10000","10000","11110","10000","10000","10000"],
"G":["01111","10000","10000","10111","10001","10001","01111"],
"H":["10001","10001","10001","11111","10001","10001","10001"],
"I":["11111","00100","00100","00100","00100","00100","11111"],
"J":["00111","00010","00010","00010","10010","10010","01100"],
"K":["10001","10010","10100","11000","10100","10010","10001"],
"L":["10000","10000","10000","10000","10000","10000","11111"],
"M":["10001","11011","10101","10101","10001","10001","10001"],
"N":["10001","11001","10101","10011","10001","10001","10001"],
"O":["01110","10001","10001","10001","10001","10001","01110"],
"P":["11110","10001","10001","11110","10000","10000","10000"],
"Q":["01110","10001","10001","10001","10101","10010","01101"],
"R":["11110","10001","10001","11110","10100","10010","10001"],
"S":["01111","10000","10000","01110","00001","00001","11110"],
"T":["11111","00100","00100","00100","00100","00100","00100"],
"U":["10001","10001","10001","10001","10001","10001","01110"],
"V":["10001","10001","10001","10001","10001","01010","00100"],
"W":["10001","10001","10001","10101","10101","10101","01010"],
"X":["10001","10001","01010","00100","01010","10001","10001"],
"Y":["10001","10001","01010","00100","00100","00100","00100"],
"Z":["11111","00001","00010","00100","01000","10000","11111"],
"0":["01110","10001","10011","10101","11001","10001","01110"],
"1":["00100","01100","00100","00100","00100","00100","01110"],
"2":["01110","10001","00001","00010","00100","01000","11111"],
"3":["11110","00001","00001","01110","00001","00001","11110"],
"4":["00010","00110","01010","10010","11111","00010","00010"],
"5":["11111","10000","10000","11110","00001","00001","11110"],
"6":["01111","10000","10000","11110","10001","10001","01110"],
"7":["11111","00001","00010","00100","01000","01000","01000"],
"8":["01110","10001","10001","01110","10001","10001","01110"],
"9":["01110","10001","10001","01111","00001","00001","11110"],
" ":["00000","00000","00000","00000","00000","00000","00000"],
".":["00000","00000","00000","00000","00000","00100","00100"],
":":["00000","00100","00100","00000","00100","00100","00000"],
"-":["00000","00000","00000","11111","00000","00000","00000"],
"#":["01010","01010","11111","01010","11111","01010","01010"],
"/":["00001","00001","00010","00100","01000","10000","10000"],
",":["00000","00000","00000","00000","00100","00100","01000"],
"+":["00000","00100","00100","11111","00100","00100","00000"],
};
function img(){
  const data=Buffer.alloc(WIDTH*HEIGHT*3);
  function rect(x,y,w,h,color){
    const left=Math.max(0,Math.floor(x)),top=Math.max(0,Math.floor(y));
    const right=Math.min(WIDTH,Math.floor(x+w)),bottom=Math.min(HEIGHT,Math.floor(y+h));
    for(let j=top;j<bottom;j++)for(let i=left;i<right;i++){
      const p=(j*WIDTH+i)*3;
      data[p]=color[0];data[p+1]=color[1];data[p+2]=color[2];
    }
  }
  function write(s,x,y,scale=3,color=C.white){
    s=String(s).toUpperCase();
    for(const ch of s){
      const bitmap=FONT[ch]||FONT[" "];
      for(let yy=0;yy<7;yy++)for(let xx=0;xx<5;xx++)
        if(bitmap[yy][xx]==="1")rect(x+xx*scale,y+yy*scale,scale,scale,color);
      x+=6*scale;
    }
  }
  function centered(s,cx,y,scale=3,color=C.white){
    const value=String(s).toUpperCase();
    write(value,Math.floor(cx-value.length*6*scale/2),y,scale,color);
  }
  function box(x,y,w,h,label,value,fill=C.panel){
    // Full-width, tall rows keep the pixel text readable in narrow mobile emails.
    rect(x,y,w,h,fill);
    centered(label,x+w/2,y+11,5,C.yellow);
    const size=Math.max(4,Math.min(9,Math.floor((w-36)/(6*Math.max(1,String(value).length)))));
    centered(value,x+w/2,y+49,size,C.white);
  }
  return {data,rect,write,centered,box};
}
function crc32(buf) {
  let c=0xffffffff;
  for(const b of buf){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}
  return (c^0xffffffff)>>>0;
}
function chunk(name,bytes){
  const tag=Buffer.from(name),len=Buffer.alloc(4),crc=Buffer.alloc(4);
  len.writeUInt32BE(bytes.length);crc.writeUInt32BE(crc32(Buffer.concat([tag,bytes])));
  return Buffer.concat([len,tag,bytes,crc]);
}
function png(data){
  const rows=Buffer.alloc((WIDTH*3+1)*HEIGHT);
  for(let y=0;y<HEIGHT;y++)data.copy(rows,y*(WIDTH*3+1)+1,y*WIDTH*3,(y+1)*WIDTH*3);
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(WIDTH,0);ihdr.writeUInt32BE(HEIGHT,4);
  ihdr[8]=8;ihdr[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),
    chunk("IDAT",zlib.deflateSync(rows,{level:6})),chunk("IEND",Buffer.alloc(0))]);
}
function show({rank,yearRank,yearPoints,points,job,asOf,note}){
  const g=img();
  g.rect(0,0,WIDTH,HEIGHT,C.black);
  g.rect(0,0,WIDTH,90,C.yellow);
  g.centered("YOUR STATS",WIDTH/2,17,8,C.black);
  g.box(20,104,640,120,"OVERALL RANK",rank||"UNAVAILABLE");
  g.box(20,236,640,120,"2026 RANK",yearRank||"UNAVAILABLE");
  g.box(20,368,640,120,"2026 XP",
    Number.isSafeInteger(yearPoints)?yearPoints.toLocaleString("en-GB"):"UNAVAILABLE");
  g.box(20,500,640,120,"TOTAL XP",
    Number.isSafeInteger(points)?points.toLocaleString("en-GB"):"UNAVAILABLE");
  const jobLabel=job?.label&&job.label.length<=23?job.label:"BIN";
  g.box(20,632,640,120,job?"CURRENT "+jobLabel+" STREAK":"CURRENT STREAK",
    job?job.active+" CLEANS":"UNAVAILABLE");
  g.box(20,764,640,120,job?jobLabel+" PERSONAL BEST":"PERSONAL BEST",
    job?job.best+" CLEANS":"UNAVAILABLE",C.green);
  const [year,month,day]=String(asOf||"").split("-");
  const mon=({"01":"JAN","02":"FEB","03":"MAR","04":"APR","05":"MAY",
    "06":"JUN","07":"JUL","08":"AUG","09":"SEP","10":"OCT","11":"NOV",
    "12":"DEC"})[month];
  const date=year&&mon&&day?day+" "+mon+" "+year:null;
  g.centered(note||(date?"AS OF "+date:"DATA NOT READY"),WIDTH/2,912,5,C.muted);
  return png(g.data);
}
function unavailable(){
  return show({rank:null,yearRank:null,yearPoints:null,points:null,job:null,asOf:""});
}
function verified(request,context){
  const url=new URL(request.url);
  const ref=(url.searchParams.get("ref")||"").trim().toUpperCase();
  const expires=url.searchParams.get("expires")||"";
  const sig=url.searchParams.get("sig")||"";
  if(ref!==REF||expires!=="2026-11-22"||!(/^[a-f0-9]{64}$/.test(sig)))return false;
  const secret=process.env.N64_PREVIEW_EMAIL_CARD_HMAC_SECRET;
  if(typeof secret!=="string"||!(/^[a-f0-9]{64}$/.test(secret)))return false;
  const expected=crypto.createHmac("sha256",Buffer.from(secret,"hex"))
    .update(KEY+"|"+ref+"|"+expires).digest("hex");
  const now=new Date();
  if(now>Date.parse(expires+"T23:59:59Z"))return false;
  return api.isExactPreview1(process.env,{hostname:url.hostname,
    deployContext:context?.deploy?.context,siteId:context?.site?.id}) &&
    crypto.timingSafeEqual(Buffer.from(sig,"hex"),Buffer.from(expected,"hex"));
}
export default async function handler(request,context) {
  if(request.method!=="GET")return new Response(null,{status:405});
  if(!verified(request,context))return new Response(null,{status:404,headers:{
    "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"
  }});
  let bytes;
  try{
    const snapshot=await getStore({name:hq.DATA_STORE,consistency:"strong"})
      .get(hq.DATA_KEY,{type:"json",consistency:"strong"});
    if(!binHistory.isBinSnapshot(snapshot)||!binHistory.displayable(snapshot.asOf))
      throw Error("missing_or_old_snapshot");
    const accounts=snapshot.accounts||[];
    const account=accounts.find(a=>a.ref.toUpperCase()===REF);
    if(!account)throw Error("account_not_found");
    const eligible=hq.eligibleRankedEmailAccounts(snapshot);
    const rankingStores={
      public:getStore({name:"n64-preview-arcade-public",consistency:"strong"}),
      private:getStore({name:"n64-preview-arcade-private",consistency:"strong"}),
      links:getStore({name:"n64-preview1-squeegee-player-links",consistency:"strong"}),
      activity:getStore({name:"n64-preview1-customer-website-xp-private",consistency:"strong"}),
      history:getStore({name:historical.BLOB_STORE,consistency:"strong"})
    };
    let rank=null,yearRank=null,yearPoints=null,points=account.points,rankingsReady=false;
    if(eligible?.aliases?.has(historical.canonicalLegacyRef(account.id))){
      try {
        const boards=await annual.getDatedScoreBoards(rankingStores,snapshot,eligible.aliases);
        const alias=historical.canonicalLegacyRef(account.id);
        rank=boards.overallBoard.entries.find(r=>r.customerRef===alias)?.rank||null;
        // Annual board rows are sorted but do not carry a rank field.
        const yearRows=boards.yearlyBoards.find(b=>b.year===2026)?.entries||[];
        const yearIndex=yearRows.findIndex(row=>row.customerRef===alias);
        yearRank=yearIndex>=0?yearIndex+1:null;
        // Use the same authoritative 2026 board row as the displayed rank.
        yearPoints=yearIndex>=0?yearRows[yearIndex].points:0;
        points=boards.overallBoard.entries.find(r=>r.customerRef===alias)?.points??points;
        rankingsReady=true;
      } catch {
        // A website-XP storage outage must not hide verified cleaning streaks.
      }
    }
    const jobs=records.jobRecords(account,snapshot.asOf);
    const brown=jobs.filter(j=>/\bBrown\b/i.test(j.label))
      .sort((a,b)=>(b.lastCompletedOn||"").localeCompare(a.lastCompletedOn||""))[0]||null;
    bytes=show({rank:rank?"#"+rank:rankingsReady?"NOT RANKED":"UNAVAILABLE",
      yearRank:yearRank?"#"+yearRank:rankingsReady?"NO 2026 XP":"UNAVAILABLE",
      yearPoints,points,job:brown||jobs[0]||null,asOf:snapshot.asOf});
  }catch{
    bytes=unavailable();
  }
  return new Response(bytes,{headers:{"Content-Type":"image/png",
    "Cache-Control":"private, max-age=300","X-Content-Type-Options":"nosniff",
    "X-Robots-Tag":"noindex, nofollow, noarchive","Referrer-Policy":"no-referrer"}});
}
export const config={path:"/api/email-leaderboard-card",method:"GET"};

// Shared pixel renderer; production caller must enforce consent before invoking.
export const renderEmailLeaderboardPng=show;
