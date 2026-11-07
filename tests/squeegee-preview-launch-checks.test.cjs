"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = p => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const area = require("../src/data/activeServiceAreas.json");

test("current rota towns are advertised; removed towns remain excluded", () => {
  const sitemap = read("public/sitemap.xml");
  const schema = read("src/HomepageServiceSchema.jsx");
  for (const town of [...area.reviewTowns,...area.removedTowns]) {
    assert.doesNotMatch(sitemap, new RegExp("bin-cleaning-" + town.toLowerCase()));
    assert.doesNotMatch(schema, new RegExp('"' + town + '"'));
  }
  for (const town of ["Bangor","Groomsport","Donaghadee","Millisle","Portaferry","Newtownards","Comber","Holywood","Carrowdore"]) {
    assert.match(sitemap,new RegExp("bin-cleaning-" + town.toLowerCase()));
    assert.match(schema,new RegExp('"' + town + '"'));
  }
  for (const town of ["Millisle","Portaferry"]) {
    const page=read("public/bin-cleaning-"+town.toLowerCase());
    assert.doesNotMatch(page, /<meta name="robots" content="noindex, follow">/);
    assert.match(page, /Exact address, postcode and collection-day availability/);
    assert.match(page, /<script type="application\/ld\+json">/);
    assert.match(page, /Book a Bin Clean/);
  }
  const headers=read("public/_headers");
  assert.doesNotMatch(headers, /\/bin-cleaning-\*\s+X-Robots-Tag:\s+index/i);
  for(const town of ["millisle","portaferry"])
    assert.match(headers, new RegExp("/bin-cleaning-"+town+"\\n  Content-Type:[^\\n]+\\n  X-Robots-Tag: index, follow"));
  assert.deepEqual(area.reviewTowns,[]);
  assert.ok(area.activeTowns.includes("Millisle"));
  assert.ok(area.activeTowns.includes("Portaferry"));
  const policy=read("src/serviceAreaPolicy.mjs");
  assert.match(policy,/REVIEW_TOWNS/);
});

test("homepage keyboard skip link is visible on focus and targets the real main landmark", () => {
  const app=read("src/App.jsx"),hero=read("src/LandingPage.jsx"),css=read("src/index.css");
  assert.match(app,/useLocation/);
  assert.match(app,/pathname === "\/" && <a href="#main-content" className="skip-link">Skip to main content<\/a>/);
  assert.match(hero,/<main id="main-content" tabIndex="-1"/);
  assert.match(css,/\.skip-link:focus/);
  assert.match(css,/\.skip-link:focus-visible/);
  assert.match(css,/\.skip-link \{[^}]*border-radius: 0/s);
  // Hidden keyboard link must be fully offscreen regardless of its font height.
  assert.match(css,/\.skip-link \{[^}]*position: fixed;[^}]*top: 0;[^}]*transform: translateY\(calc\(-100% - 8px\)\)/s);
  assert.match(css,/\.skip-link:focus,[\s\S]*\.skip-link:focus-visible \{[^}]*transform: translateY\(10px\)/);
  assert.doesNotMatch(css,/\.skip-link \{[^}]*top:\s*-\d+px/s);

});

test("Squeegee portal script is loaded only near portal or on direct portal route", () => {
  const portal=read("src/components/CustomerPortalLoader.jsx");
  assert.match(portal,/IntersectionObserver\(entries =>/);
  assert.match(portal,/rootMargin: "500px 0px"/);
  assert.match(portal,/standalone \|\| !section/);
  assert.match(portal,/squeegee-widget-script/);
  assert.match(portal,/observer\.disconnect\(\)/);
  assert.match(portal,/customer-portal-login/);
  assert.match(read("src/App.jsx"),/<CustomerPortalLoader \/>/);
});

test("leaderboard reads consent fresh on each GET, and Customer HQ shares only request-local snapshots", () => {
  const board=read("netlify/functions/arcadeLeaderboard.js");
  const hq=read("netlify/functions/customerHQ.mjs");
  assert.match(board,/const \[privateCustomers,privateNames,mode,published\]=await Promise\.all/);
  assert.match(board,/stores\.names\.get\(nameConsents\.KEY/);
  assert.match(board,/previewFirstNameScoreboard\(/);
  assert.doesNotMatch(board,/consentCache|cachedConsent|cachedPublicNames/);
  assert.match(hq,/async function lookupVerifiedSession\(request,ledger,now=Date\.now\(\),sharedSnapshot=null,reader=api\)/);
  assert.match(hq,/lookupVerifiedSession\(request,ledger,Date\.now\(\),snapshot,access\.reader\)/);
  assert.match(hq,/verifiedPersonalSummary\(session,snapshot,sharedConsent\)/);
  assert.match(hq,/consentChoice\(session\.account\.id,sharedConsent\)/);
  assert.match(hq,/Cache-Control":"private, no-store, max-age=0/);
  assert.match(hq,/reader\.getCustomer\(account\.id\)/);
  assert.match(hq,/onlyIfMatch:existing\.etag/);
});

test("release checks retain customer count and distinct verified and estimated bin totals", () => {
  const stats=read("src/data/statsPlan.js"),counter=read("src/data/dailyBinCounter.mjs");
  const verified=read("src/data/verifiedCompletedServices.mjs");
  assert.match(stats,/monthlyCustomers: OWNER_MONTHLY_PLAN\.monthlyCustomers/);
  assert.match(stats,/ownerEstimatedBinsSince\(VERIFIED_COMPLETED_SERVICES\.asOf,now\)/);
  assert.match(counter,/OWNER_ESTIMATED_BINS_PER_DAY = 200/);
  assert.match(verified,/beforeSqueegeeBins: 14000/);
  assert.match(verified,/LIFETIME_COMPLETED_BINS/);
});
