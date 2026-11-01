"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const source=fs.readFileSync(path.join(
  __dirname,"../src/components/CustomerTrustSections.jsx"
),"utf8");

test("all customer questions start collapsed, including Prices & Plans",()=>{
  assert.match(source,/export function CustomerQuestions\(\{ onBook \}\)/);
  assert.match(source,/const \[selectedTopicId, setSelectedTopicId\] = useState\("pricing"\)/);
  assert.match(source,/const \[openQuestion, setOpenQuestion\] = useState\(null\)/);
  assert.doesNotMatch(source,/setOpenQuestion\] = useState\(0\)/);
});

test("selecting any other topic never auto-opens its first answer",()=>{
  assert.match(source,/const chooseTopic = \(topic\) => \{[\s\S]*?setSelectedTopicId\(topic.id\);\s*setOpenQuestion\(null\);/);
  assert.doesNotMatch(source,/setOpenQuestion\(topic\.indices\[0\]\)/);
  assert.deepEqual(
    [...source.matchAll(/id: "(?:pricing|service|clean-day|booking)"/g)]
      .map(match=>match[0]),
    ['id: "pricing"','id: "service"','id: "clean-day"','id: "booking"']
  );
});

test("a customer explicitly opens or closes each answer with the plus/minus button",()=>{
  assert.match(source,/const isOpen = openQuestion === faqIndex/);
  assert.match(source,/onClick=\{\(\) => setOpenQuestion\(isOpen \? null : faqIndex\)\}/);
  assert.match(source,/aria-expanded=\{isOpen\}/);
  assert.match(source,/hidden=\{!isOpen\}/);
  assert.match(source,/aria-controls=\{"n64-help-answer-" \+ faqIndex\}/);
  assert.match(source,/aria-labelledby=\{"n64-help-question-" \+ faqIndex\}/);
  assert.match(source,/\{isOpen \? "−" : "\+"\}/);
});

test("the existing 10 questions and 4 topic sections are preserved",()=>{
  const qSection=source.slice(source.indexOf("const FAQs = ["),source.indexOf("function ratingStars"));
  assert.equal((qSection.match(/question:/g)||[]).length,10);
  const topics=source.slice(source.indexOf("const QUESTION_TOPICS = ["),source.indexOf("export function CustomerQuestions"));
  assert.equal((topics.match(/indices: \[/g)||[]).length,4);
  assert.match(source,/10 QUESTIONS/);
  assert.match(source,/4 TOPICS/);
});
