"use strict";
import zlib from "node:zlib";

// Harmless image-only diagnostic. No private customer lookup or reference is returned.
// Use in a Squeegee test email to verify whether [customerRef] expands in an img src.
const WIDTH=160, HEIGHT=40;
function crc32(data){
 let c=0xffffffff;
 for(const byte of data){c^=byte;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}
 return (c^0xffffffff)>>>0;
}
function chunk(type,data){
 const name=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);
 size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));
 return Buffer.concat([size,name,data,crc]);
}
function makePng(success){
 const rows=Buffer.alloc((WIDTH*3+1)*HEIGHT);
 const color=success?[30,156,86]:[188,62,50];
 for(let y=0;y<HEIGHT;y++)for(let x=0;x<WIDTH;x++){
  const p=y*(WIDTH*3+1)+1+x*3;
  const shade=(x<6||x>=WIDTH-6||y<6||y>=HEIGHT-6)?0.55:1;
  for(let i=0;i<3;i++)rows[p+i]=Math.round(color[i]*shade);
 }
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(WIDTH,0);ihdr.writeUInt32BE(HEIGHT,4);
 ihdr[8]=8;ihdr[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),
 chunk("IDAT",zlib.deflateSync(rows)),chunk("IEND",Buffer.alloc(0))]);
}
export default function handler(request){
 if(request.method!=="GET")return new Response(null,{status:405});
 const ref=new URL(request.url).searchParams.get("ref")||"";
 // Do not reveal or log the supplied value. Green means a plausible expanded ref.
 const expanded=/^(?:CUS[0-9]{1,15}|[0-9]{1,12}|AA[0-9]{3,8})$/i.test(ref);
 return new Response(makePng(expanded),{headers:{
  "Content-Type":"image/png","Cache-Control":"no-store",
  "X-Content-Type-Options":"nosniff","X-Robots-Tag":"noindex, nofollow, noarchive",
  "Referrer-Policy":"no-referrer"
 }});
}
export const config={path:"/api/squeegee-email-token-probe",method:"GET"};
