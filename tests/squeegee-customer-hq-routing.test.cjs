"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT=path.resolve(__dirname,"..");
const lines=fs.readFileSync(path.join(ROOT,"public/_redirects"),"utf8")
  .split(/\r?\n/).map(line=>line.trim())
  .filter(line=>line&&!line.startsWith("#"));
const match=(from)=>lines.findIndex(line=>line.split(/\s+/)[0]===from);
test("Customer HQ and trailing slash rewrite to React index BEFORE short certificate wildcard",()=>{
  const short=match("/:shortcode");
  assert.ok(short>=0,"short certificate wildcard must still exist");
  for(const route of ["/customer-hq","/customer-hq/"]){
    const i=match(route);
    assert.ok(i>=0,route+" route missing from public/_redirects");
    assert.ok(i<short,"shortcode handler must not shadow "+route);
    assert.equal(lines[i],route+" /index.html 200");
  }
});
test("preview site builds and publishes _redirects, not only netlify.toml",()=>{
  const config=fs.readFileSync(path.join(ROOT,"vite.config.js"),"utf8");
  assert.match(config,/src:\s*['"]public\/_redirects['"]/);
  assert.match(config,/dest:\s*['"]\.[\'"]/);
  const app=fs.readFileSync(path.join(ROOT,"src/App.jsx"),"utf8");
  assert.match(app,/<Route path="\/customer-hq" element=\{<CustomerHQ \/>\}/);
  const page=fs.readFileSync(path.join(ROOT,"src/pages/CustomerHQ.jsx"),"utf8");
  assert.match(page,/\/api\/customer-hq/);
});
test("Customer HQ is not accidentally routed to streetTermsDocument",()=>{
  const i=match("/customer-hq"),short=match("/:shortcode");
  assert.ok(i<short);
  assert.ok(!lines[i].includes("streetTermsDocument"));
  assert.ok(lines.some(line=>line.startsWith("/customer-documents/street-terms/")));
});


test("dedicated Squeegee portal (with or without slash) avoids the certificate handler",()=>{
  const short=match("/:shortcode");
  assert.ok(short>=0);
  for(const route of ["/squeegee-portal","/squeegee-portal/"]){
    const i=match(route);
    assert.ok(i>=0,route+" must be in the actual published _redirects file");
    assert.ok(i<short,route+" must win before the shortcode certificate rule");
    assert.equal(lines[i],route+" /index.html 200");
  }
  const toml=fs.readFileSync(path.join(ROOT,"netlify.toml"),"utf8");
  assert.match(toml,/from = "\/squeegee-portal"\s+to = "\/index\.html"\s+status = 200/);
});

test("all Customer HQ Squeegee buttons open the portal route, never a homepage anchor",()=>{
  const code=fs.readFileSync(path.join(ROOT,"src/pages/CustomerHQ.jsx"),"utf8");
  const target='href="/squeegee-portal?ntl-drawer-state=hidden"';
  assert.equal(code.split(target).length-1,3);
  assert.ok(!code.includes('href="/#customer-portal"'));
});

test("Squeegee standalone page uses original official widget, not a fake login or API",()=>{
  const app=fs.readFileSync(path.join(ROOT,"src/App.jsx"),"utf8");
  assert.match(app,/<Route path="\/squeegee-portal" element=\{<SqueegeePortalPage \/>\}/);
  const page=fs.readFileSync(path.join(ROOT,"src/pages/SqueegeePortalPage.jsx"),"utf8");
  assert.match(page,/<CustomerPortalLoader standalone \/>/);
  assert.match(page,/\/customer-hq\?ntl-drawer-state=hidden/);
  const portal=fs.readFileSync(path.join(ROOT,"src/components/CustomerPortalLoader.jsx"),"utf8");
  assert.match(portal,/https:\/\/widgets\.sqg\.ee\/main\.js/);
  assert.match(portal,/data-sqc="layout"/);
  assert.match(portal,/data-sqa="25a031e7-75af-4a0e-9f3a-d308fd9b2e3a"/);
  assert.match(portal,/data-sqe="https:\/\/sqgee\.com"/);
  assert.match(portal,/standalone = false/);
  assert.ok(!page.includes("SQUEEGEE_API_KEY"));
  assert.ok(!page.includes("/api/squeegee"));
});
