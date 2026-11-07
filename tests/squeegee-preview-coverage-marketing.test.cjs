"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const towns=require("../src/data/activeServiceAreas.json");
test("homepage area links advertise only verified towns, not stale historical round locations",()=>{
  const links=read("src/serviceAreaLinks.js");
  const injected=read("public/privacy-link.js");
  const fallback=read("public/town-page.js");
  for(const town of towns.reviewTowns.concat(towns.removedTowns)){
    const re=new RegExp('(?:name:\\s*[\\x27"]|\\[")[ ]*'+town+'\\b',"i");
    assert.doesNotMatch(links,re);
    assert.doesNotMatch(injected,re);
    assert.doesNotMatch(fallback,re);
  }
  for(const town of ["Bangor","Groomsport","Carrowdore","Newtownards","Holywood","Donaghadee","Millisle","Portaferry","Comber"]){
    assert.match(links,new RegExp("name: '"+town+"'"));
  }
  assert.match(links,/border-radius:0;/);
});
test("SEO coverage matches confirmed Millisle and Portaferry current rounds",()=>{
  const html=read("index.html");
  for(const town of ["Millisle","Portaferry"]) assert.ok(html.includes('"name": "'+town+'"'));
  assert.match(html,/"name": "Conlig"/);
  assert.match(html,/Exact property availability is checked/);
  assert.ok(html.includes("privacy-link.js?v=20261107-current-covered-towns"));
});
