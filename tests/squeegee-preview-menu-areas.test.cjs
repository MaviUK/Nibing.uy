"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const ROOT=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(ROOT,"index.html"),"utf8");
const areasScript=fs.readFileSync(path.join(ROOT,"public/privacy-link.js"),"utf8");
const menu=html.match(/<nav id="site-section-menu"[\s\S]*?<\/nav>/)?.[0];
assert.ok(menu,"the mobile site menu must exist");

test("the mobile menu includes exactly one Areas We Cover button in page order",()=>{
  const link='<a href="#areas-we-cover">Areas We Cover</a>';
  assert.equal(menu.split(link).length-1,1);
  assert.ok(menu.indexOf("Customer Questions")<menu.indexOf(link));
  assert.ok(menu.indexOf(link)<menu.indexOf("Customer Portal"));
  assert.ok(menu.includes('href="#customer-portal-login"'));
});

test("Areas We Cover links to the existing real homepage section",()=>{
  // This section is inserted after React mounts, by the public privacy
  // and areas script. A menu entry must target that exact ID.
  assert.match(areasScript,/section\.id="areas-we-cover"/);
  assert.match(areasScript,/insertBefore\(section,target\)/);
  assert.match(html,/src="\/privacy-link\.js\?[^"]+"\s+defer/);
  assert.match(areasScript,/if\(document\.readyState==="loading"\)/);
  assert.match(areasScript,/MutationObserver\(addAreasSection\)/);
});

test("tapping an area menu link closes the menu like all other section links",()=>{
  assert.match(html,/menu\.addEventListener\("click",[\s\S]*?if \(event\.target\.closest\("a"\)\) closeMenu\(\)/);
  assert.match(html,/#site-section-menu a,\s*#site-section-menu button/);
});
