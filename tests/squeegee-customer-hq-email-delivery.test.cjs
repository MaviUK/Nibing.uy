"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const read=file=>fs.readFileSync(path.join(__dirname,"..",file),"utf8");
const server=read("netlify/functions/customerHQ.mjs");
const ui=read("src/pages/CustomerHQ.jsx");

test("request-code must stay non-enumerating and log only outcome stage, not identity",()=>{
  assert.match(server,/const account=auth\.accountForEmail\(snapshot,email\)/);
  assert.match(server,/if\(await currentlyActive\(account\.id,email,access\.reader\)\)/);
  assert.match(server,/const sent=await auth\.issueCode\(/);
  assert.match(server,/console\.info\("customer_hq_otp_outcome",internalOutcome\)/);
  assert.match(server,/no_unique_snapshot_match/);
  assert.match(server,/live_identity_not_verified/);
  assert.match(server,/otp_sent/);
  assert.match(server,/otp_not_issued/);
  assert.match(server,/identity_lookup_failed/);
  assert.match(server,/challengeId:challengeId\|\|crypto\.randomBytes/);
  assert.doesNotMatch(server,/console\.(log|info|error)\([^\n]*(email|account\.id|challengeId|code)\s*[,)]/);
});

test("Customer HQ no longer promises an email was sent when account verification skipped it",()=>{
  assert.doesNotMatch(ui,/a sign-in code has been sent\. Check your inbox/);
  assert.match(ui,/For privacy, this page always shows the code entry step/);
  assert.match(ui,/exactly matches one active Squeegee customer account/);
  assert.match(ui,/Email address entered:/);
  assert.match(ui,/email\.trim\(\)/);
  assert.match(ui,/Use another email or request a new code/);
});
