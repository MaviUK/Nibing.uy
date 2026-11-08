const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const jsx=fs.readFileSync(path.join(__dirname,"../src/components/ArcadeLeaderboard.jsx"),"utf8");
const css=fs.readFileSync(path.join(__dirname,"../src/n64-finale.css"),"utf8");

test("leaderboard and Records both open the one shared XP help dialog",()=>{
  const buttons=jsx.match(/HOW DO I EARN &amp; LOSE XP\?/g)||[];
  assert.equal(buttons.length,2);
  assert.equal((jsx.match(/showPointsGuide && createPortal/g)||[]).length,1);
  assert.equal((jsx.match(/onClick=\{openPointsGuide\}/g)||[]).length,2);
  const records=jsx.slice(jsx.indexOf('className="n64-board-tab-content n64-board-records-tab"'));
  assert.match(records,/n64-points-help-trigger/);
  assert.match(records,/aria-controls="n64-points-guide-dialog"/);
});

test("old records footnote is removed while the XP dialog keeps its rules",()=>{
  assert.doesNotMatch(jsx,/n64-public-record-footnote/);
  assert.doesNotMatch(jsx,/Fewer than five entries appear where fewer qualify/);
  assert.doesNotMatch(css,/n64-public-record-footnote/);
  assert.match(jsx,/Earn XP for paid cleans/);
  assert.match(jsx,/Lose XP for overdue payments/);
  assert.match(jsx,/Keep your cleaning streak/);
  assert.match(jsx,/Bonus website XP/);
});

test("closing the shared dialog restores focus to the invoking button",()=>{
  assert.match(jsx,/pointsGuideReturnFocusRef\.current=event\.currentTarget/);
  assert.match(jsx,/pointsGuideReturnFocusRef\.current\?\.focus\(\)/);
  assert.match(jsx,/aria-modal="true"/);
});
