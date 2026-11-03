"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const link=require("../netlify/functions/lib/squeegeeOwnerReviewLink");
const alert=require("../netlify/functions/lib/squeegeeSyncOwnerAlert");
const env={SQUEEGEE_API_KEY:"unit-test-only-squeegee-secret-not-a-real-key"};
const now=Date.parse("2026-11-01T12:00:00Z");
const bookingId="NBG-4QUNP343",day="2026-10-31";

test("owner email carries a valid signed and time-limited link bound to one booking",()=>{
  const url=link.issueLink(bookingId,day,{env,now});
  assert.ok(url.startsWith(link.ORIGIN+link.PATH+"?"));
  const parsed=new URL(url);
  const params=Object.fromEntries(parsed.searchParams);
  assert.equal(link.verifyLink(params,{env,now:now+1000}),true);
  assert.equal(link.verifyLink({...params,bookingId:"NBG-2ABCDEFGH"},{env,now}),false);
  assert.equal(link.verifyLink({...params,day:"2026-10-30"},{env,now}),false);
  assert.equal(link.verifyLink({...params,expires:String(now+link.VALID_MS+1)},{env,now}),false);
  assert.equal(link.verifyLink({...params,signature:"a".repeat(64)},{env,now}),false);
  assert.equal(link.verifyLink(params,{env,now:now+link.VALID_MS}),false);
  assert.equal(link.verifyLink(params,{env,now:now-1000}),false);
  assert.equal(link.verifyLink(params,{env:{SQUEEGEE_API_KEY:"other-secret-not-real-testing-123456789"},now}),false);
  assert.equal(link.verifyLink({...params,signature:""},{env,now}),false);
  assert.equal(link.verifyLink({bookingId,day},{env,now}),false);
  assert.equal(link.issueLink(bookingId,"2026-02-30",{env,now}),null);
  assert.equal(link.issueLink(bookingId,day,{env:{},now}),null);
});

test("email link still requires a separate tamper-resistant confirmation POST",()=>{
  const params=Object.fromEntries(new URL(link.issueLink(bookingId,day,{env,now})).searchParams);
  const csrf=link.confirmationToken(params,env);
  assert.match(csrf,/^[0-9a-f]{64}$/);
  assert.notEqual(link.confirmationToken({...params,day:"2026-10-30"},env),csrf);
  assert.notEqual(link.confirmationToken({...params,signature:"0".repeat(64)},env),csrf);
  const route=fs.readFileSync(path.join(__dirname,
    "../netlify/functions/squeegeePreviewOwnerReactivation.mjs"),"utf8");
  assert.match(route,/ownerLink\.verifyLink\(authParams/);
  assert.match(route,/ownerLink\.confirmationToken\(authParams,process\.env\)/);
  assert.match(route,/secureEqual\(form\.get\("csrf"\),expectedCsrf\)/);
  assert.match(route,/if\(request\.method==="POST"\)return resumeOnce/);
  assert.match(route,/claims\.claimOnce\(/);
  assert.match(route,/api\.isExactPreview1\(process\.env,scope\)/);
  assert.doesNotMatch(route,/if\(request\.method==="GET"\)return resumeOnce/);
});

test("inactive hold email signs the actual owner link and never adds a second access code",()=>{
  const email=alert.emailContent(bookingId,
    "existing_customer_reactivation_required",{
      customerName:"Example Customer",
      bookingSubmittedDay:day,
      requestedBinCounts:["1 x Brown Bin"],
    },{env,now});
  assert.match(email.html,/PROCESS BOOKING AFTER REACTIVATION/);
  assert.match(email.html,/seven days/i);
  const match=email.text.match(/PROCESS BOOKING AFTER REACTIVATION: (https:\/\/\S+)/);
  assert.ok(match);
  const params=Object.fromEntries(new URL(match[1]).searchParams);
  assert.equal(link.verifyLink(params,{env,now:now+5000}),true);
  assert.doesNotMatch(email.html,/Email me an owner access code/);
  const noSecret=alert.emailContent(bookingId,
    "existing_customer_reactivation_required",{
      bookingSubmittedDay:day,
    },{env:{},now});
  assert.doesNotMatch(noSecret.html,/PROCESS BOOKING AFTER REACTIVATION/);
  const ambiguous=alert.emailContent(bookingId,
    "customer_match_ambiguous_or_incomplete",{
      bookingSubmittedDay:day,
    },{env,now});
  assert.doesNotMatch(ambiguous.html,/PROCESS BOOKING AFTER REACTIVATION/);
});
