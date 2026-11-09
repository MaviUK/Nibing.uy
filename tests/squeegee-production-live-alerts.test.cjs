"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const alerts=require("../netlify/functions/lib/squeegeeSyncOwnerAlert");

const bookingId="NBG-K7P4R2XM";
const productionStatus="https://nibing.uy/api/squeegee-production-auto-status?bookingId="+bookingId;
const previewStatus="https://deploy-preview-77--nibinguy.netlify.app/api/squeegee-preview-auto-status?bookingId="+bookingId;

test("live booking holds link to production owner-only status, never Preview 77",()=>{
  const alert=alerts.emailContent(bookingId,"automatic_sync_not_enabled",{
    requestedBinCounts:["1 x Black Bin"],
    firstCleanDates:["2026-11-23"],
    bookingTotal:5,
  },{mode:"production"});
  assert.ok(alert);
  assert.match(alert.subject,/needs review/i);
  assert.ok(alert.text.includes(productionStatus));
  assert.ok(alert.html.includes(productionStatus));
  assert.ok(!alert.text.includes(previewStatus));
  assert.ok(!alert.html.includes(previewStatus));
  assert.ok(alert.text.includes("Production Squeegee booking alert"));
});

test("production inactive customer alerts do not offer preview-only reactivation",()=>{
  const alert=alerts.emailContent(bookingId,"existing_customer_reactivation_required",{
    customerName:"Example Name",
    requestedBinCounts:["1 x Brown Bin"],
    bookingSubmittedDay:"2026-11-09",
  },{mode:"production"});
  assert.ok(alert);
  assert.ok(alert.text.includes(productionStatus));
  assert.ok(!alert.text.includes(previewStatus));
  assert.ok(!alert.text.includes("PROCESS BOOKING AFTER REACTIVATION"));
});

test("preview-only messages retain existing preview status and recovery links",()=>{
  const alert=alerts.emailContent(bookingId,"automatic_sync_not_enabled",{},
    {mode:"preview"});
  assert.ok(alert.text.includes(previewStatus));
  assert.ok(!alert.text.includes(productionStatus));
});

test("live booking acceptance warns owner and stores a reconciliation record when sync is disabled",()=>{
  const source=fs.readFileSync(path.join(__dirname,
    "../netlify/functions/sendBookingEmail.js"),"utf8");
  assert.match(source,/const productionSyncUnavailable=isProductionHost && !deferAdminForProduction/);
  assert.match(source,/reviewOwnerMessage\("automatic_sync_not_enabled"\)/);
  assert.match(source,/if\(productionSyncUnavailable\) \{/);
  assert.match(source,/stage:details\?\.reason==="automatic_sync_not_enabled"\?/);
  assert.match(source,/if\(!isProductionHost\)return recordNoDispatch/);
  assert.match(source,/mode:isProductionHost\?"production":"preview"/);
  const worker=fs.readFileSync(path.join(__dirname,
    "../netlify/functions/squeegeeProductionAutoSync.mjs"),"utf8");
  assert.match(worker,/mode:"production"/);
});
