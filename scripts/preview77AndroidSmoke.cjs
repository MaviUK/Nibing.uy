"use strict";
// Non-destructive Android viewport acceptance. Never POST a booking or enter PII.
const {chromium,devices}=require("playwright");
const fs=require("node:fs");
(async()=>{
 const origin="https://deploy-preview-77--nibinguy.netlify.app";
 const browser=await chromium.launch({headless:true});
 const context=await browser.newContext({...devices["Galaxy S9+"],
   viewport:{width:393,height:852},isMobile:true,hasTouch:true});
 const page=await context.newPage();
 const start=Date.now();
 try{
  const response=await page.goto(origin+"/?weather=night",{waitUntil:"domcontentloaded",timeout:45000});
  if(!response||response.status()!==200)throw Error("Homepage HTTP "+response?.status());
  const homeNavigation=await page.evaluate(()=>{
   const entry=performance.getEntriesByType("navigation")[0];
   const fcp=performance.getEntriesByName("first-contentful-paint")[0];
   return {domContentLoadedMs:Math.round(entry?.domContentLoadedEventEnd||0),
     responseEndMs:Math.round(entry?.responseEnd||0),
     firstContentfulPaintMs:fcp?Math.round(fcp.startTime):null};
  });
  await page.locator("#main-content").waitFor({state:"visible",timeout:20000});
  await page.locator(".n64-top-actions").waitFor({state:"visible",timeout:20000});
  const dimensions=await page.evaluate(()=>({
   width:window.innerWidth,
   scrollWidth:document.documentElement.scrollWidth,
   skip:document.querySelector(".skip-link")?.getBoundingClientRect().bottom||null,
   topButtonCount:document.querySelectorAll(".n64-top-actions button").length
  }));
  if(dimensions.scrollWidth>dimensions.width+5)
    throw Error("Mobile horizontal overflow "+JSON.stringify(dimensions));
  if(dimensions.skip!==null&&dimensions.skip>0)
    throw Error("Hidden accessibility link visible at viewport top: "+dimensions.skip);
  if(dimensions.topButtonCount<2)throw Error("Missing primary action buttons");
  await page.getByRole("button",{name:"Book a Clean",exact:true}).first().click();
  await page.getByRole("dialog").first().waitFor({state:"visible",timeout:15000});
  await page.screenshot({path:"mobile-qa/booking-dialog.png",fullPage:false});
  // Do not enter customer details, accept terms, or press Confirm.
  await page.goto(origin+"/?weather=night",{waitUntil:"domcontentloaded",timeout:45000});
  await page.getByRole("button",{name:"Check whether we cover your postcode"}).click();
  await page.getByRole("dialog").first().waitFor({state:"visible",timeout:15000});
  await page.screenshot({path:"mobile-qa/coverage-dialog.png",fullPage:false});
  const timings={
   homepageNavigation:homeNavigation,
   safeTwoDialogJourneyMs:Date.now()-start,
   width:dimensions.width,
   documentWidth:dimensions.scrollWidth,
   hiddenSkipLinkBottom:dimensions.skip,
   safeBookingDialog:"opened_without_submission",
   safeCoverageDialog:"opened_without_submission"
  };
  fs.writeFileSync("mobile-qa/results.json",JSON.stringify(timings,null,2));
  console.log("PASS "+JSON.stringify(timings));
 }finally{
  await browser.close();
 }
})().catch(e=>{console.error("MOBILE_SMOKE_FAILED:",e.message);process.exitCode=1;});
