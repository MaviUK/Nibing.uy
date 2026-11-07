"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"..");
const serverSource=fs.readFileSync(path.join(root,"netlify/functions/googleReviews.js"),"utf8");
const viewSource=fs.readFileSync(path.join(root,"src/components/CustomerTrustSections.jsx"),"utf8");
const stylesheet=fs.readFileSync(path.join(root,"src/n64-trust.css"),"utf8");

test("the existing Google Reviews section offers a direct Google-hosted write review CTA",()=>{
 assert.match(viewSource,/id="customer-reviews"/);
 assert.match(viewSource,/Leave a Google Review/);
 assert.match(viewSource,/reviewData\?\.writeReviewUrl/);
 assert.match(viewSource,/href=\{writeReviewLink\} target="_blank" rel="noopener noreferrer"/);
 assert.match(viewSource,/View on Google/);
 assert.match(viewSource,/Google sign-in may be required/);
 assert.doesNotMatch(viewSource,/<iframe[^>]*(?:write|review)/i);
 assert.match(stylesheet,/n64-trust-link--write-review/);
 assert.match(stylesheet,/border-radius:0/);
});
test("Google Places requests its documented write-a-review URI",()=>{
 assert.match(serverSource,/googleMapsLinks\.writeAReviewUri/);
 assert.match(serverSource,/writeReviewUrl:/);
 assert.match(serverSource,/search\.google\.com\/local\/writereview\?placeid=/);
});

test("official Google write-review URL reaches the CTA API; fallback uses the looked-up place ID",async()=>{
 // The module has no imports and is loaded in isolation; never reach Google.
 const url="data:text/javascript;base64,"+Buffer.from(serverSource).toString("base64");
 const module=await import(url);
 const originalFetch=global.fetch;
 const originalKey=process.env.GOOGLE_PLACES_API_KEY;
 const originalPlace=process.env.GOOGLE_PLACE_ID;
 const originalFallback=process.env.GOOGLE_MAPS_API_KEY;
 const placeId="ChIJ1234567890abcdefghij";
 const official="https://www.google.com/maps/place/NI+Bin+Guy/data=!4m3!12e1";
 let officialReturned=true;
 try{
   process.env.GOOGLE_PLACES_API_KEY="local-test-only-key";
   process.env.GOOGLE_PLACE_ID=placeId;
   delete process.env.GOOGLE_MAPS_API_KEY;
   global.fetch=async(resource,options)=>{
     assert.match(String(resource),/places\.googleapis\.com\/v1\/places\//);
     assert.equal(options.headers["X-Goog-Api-Key"],"local-test-only-key");
     assert.match(options.headers["X-Goog-FieldMask"],/googleMapsLinks\.writeAReviewUri/);
     const payload={id:placeId,displayName:{text:"Ni Bin Guy"},rating:4.9,
       reviews:[],googleMapsUri:"https://www.google.com/maps/place/NI+Bin+Guy",
       googleMapsLinks:officialReturned?{writeAReviewUri:official}:{}};
     return new Response(JSON.stringify(payload),{status:200});
   };
   const first=await module.default({method:"GET"});
   assert.equal(first.status,200);
   const firstJson=await first.json();
   assert.equal(firstJson.writeReviewUrl,official);
   assert.equal(firstJson.businessName,"Ni Bin Guy");
   officialReturned=false;
   const second=await module.default({method:"GET"});
   const secondJson=await second.json();
   assert.equal(secondJson.writeReviewUrl,
     "https://search.google.com/local/writereview?placeid="+encodeURIComponent(placeId));
 }finally{
   global.fetch=originalFetch;
   if(originalKey===undefined)delete process.env.GOOGLE_PLACES_API_KEY;
   else process.env.GOOGLE_PLACES_API_KEY=originalKey;
   if(originalPlace===undefined)delete process.env.GOOGLE_PLACE_ID;
   else process.env.GOOGLE_PLACE_ID=originalPlace;
   if(originalFallback===undefined)delete process.env.GOOGLE_MAPS_API_KEY;
   else process.env.GOOGLE_MAPS_API_KEY=originalFallback;
 }
});
