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
