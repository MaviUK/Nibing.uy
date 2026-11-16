"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {sameDayAllowed} = require("../netlify/functions/lib/bookingSameDayPolicy");
test("standard booking remains blocked after 10am UK time", () => {
 assert.equal(sameDayAllowed({now:"2026-11-16T10:00:00Z"}),false);
 assert.equal(sameDayAllowed({now:"2026-11-16T09:59:00Z"}),true);
});
test("unverified street channel cannot bypass cutoff", () => {
 assert.equal(sameDayAllowed({channel:"street-signup",now:"2026-11-16T18:00:00Z"}),false);
});
test("verified staff street signup can use same-day after cutoff", () => {
 assert.equal(sameDayAllowed({channel:"street-signup",staffVerified:true,now:"2026-11-16T18:00:00Z"}),true);
});
test("summer cutoff uses UK local time not UTC", () => {
 assert.equal(sameDayAllowed({now:"2026-07-01T09:00:00Z"}),false);
 assert.equal(sameDayAllowed({now:"2026-07-01T08:59:00Z"}),true);
});
