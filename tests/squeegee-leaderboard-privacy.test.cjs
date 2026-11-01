"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const Module = require("node:module");
const {
  publicCustomerReference, townFromAddress, safePublicTown, safePublicReference
} = require("../netlify/functions/lib/arcadePublicIdentity.js");

test("public NBG refs are stable, keyed and not email hashes or booking IDs", () => {
  const key = crypto.createHash("sha256").update("jane@example.org").digest("hex");
  const a = publicCustomerReference(key, "a-secret-longer-than-16-chars");
  assert.match(a, /^NBG-[A-F0-9]{10}$/);
  assert.equal(a, publicCustomerReference(key, "a-secret-longer-than-16-chars"));
  assert.notEqual(a, publicCustomerReference(key, "a-different-long-secret"));
  assert.notEqual(a.slice(4), key.slice(0, 10).toUpperCase());
  assert.equal(publicCustomerReference(key, ""), null);
  assert.equal(publicCustomerReference("jane@example.org", "secret-longer-than-16"), null);
  assert.equal(safePublicReference("Jane Smith"), null);
});

test("town parsing never publishes a street, postcode, unverified place, or arbitrary value", () => {
  assert.equal(townFromAddress("34 Ballycrochan Avenue, Bangor, BT19 7AA"), "Bangor");
  assert.equal(townFromAddress("12 Bangor Road, Newtownards, BT23 4AA"), "Newtownards");
  assert.equal(townFromAddress("4 Station Road, Helen's Bay, BT19 1AD"), "Helens Bay");
  assert.equal(townFromAddress("12 High Street, Holywood BT18 5AB"), "Holywood");
  assert.equal(townFromAddress("4 Bangor Road, BT20 1AA"), "Town unavailable");
  assert.equal(townFromAddress("4 Nonexistent Town Road, BT23 5AA"), "Town unavailable");
  assert.equal(safePublicTown("12 Bangor Road, Newtownards, BT23 4AA"), "Town unavailable");
  assert.equal(safePublicTown("Portavogie"), "Portavogie");
});

test("legacy public names and v2 snapshots cannot leak through either new GET or registration", async () => {
  const envSecret = process.env.N64_PREVIEW_LEADERBOARD_SECRET;
  const envResend = process.env.RESEND_API_KEY;
  const originalLoad = Module._load;
  const secret = "test-leaderboard-pseudonym-secret-2026-11";
  process.env.N64_PREVIEW_LEADERBOARD_SECRET = secret;
  delete process.env.RESEND_API_KEY;
  const email = "jane-example@example.org";
  const playerKey = crypto.createHash("sha256").update(email).digest("hex");
  const recordKey = "player:" + playerKey;
  const now = "2026-10-31T12:00:00.000Z";
  const publicData = new Map([
    [recordKey, {
      displayName: "Jane Private Example", points: 550,
      createdAt: now, lastUpdatedAt: now
    }],
    ["leaderboard:top10:v2", {
      entries: [{ rank: 1, name: "Jane Private Example", points: 550 }],
      totalPlayers: 1, builtAt: new Date().toISOString()
    }]
  ]);
  const privateData = new Map([[
    recordKey, {
      enrolledAt: now, consentedAt: now, address: "15 Mill Road, Newtownards, BT23 3AA",
      email, name: "Jane Private Example", points: 550, progressXP: 0,
      bookingId: "NBG-EXAMPLE-11223344", bookingIds: ["NBG-EXAMPLE-11223344"]
    }
  ]]);
  const fakeStore = map => ({
    async get(key) { return map.get(key) || null; },
    async delete(key) { map.delete(key); },
    async setJSON(key, value, options = {}) {
      if (options.onlyIfMatch && options.onlyIfMatch !== '"etag:' + key + '"')
        return { modified: false };
      map.set(key, value);
      return { modified: true, etag: '"new"' };
    },
    async list({ prefix }) {
      return { blobs: [...map.keys()].filter(key => key.startsWith(prefix))
        .map(key => ({ key, etag: '"etag:' + key + '"' })) };
    }
  });
  const pub = fakeStore(publicData), priv = fakeStore(privateData);
  const historyData = new Map(), linkData = new Map();
  const history = fakeStore(historyData), links = fakeStore(linkData);
  Module._load = function (id, parent, isMain) {
    if (id === "@netlify/blobs") return {
      getStore({ name }) {
        if (name === "n64-preview-arcade-public") return pub;
        if (name === "n64-preview-arcade-private") return priv;
        if (name === "n64-preview1-squeegee-active-only") return history;
        if (name === "n64-preview1-squeegee-player-links") return links;
        throw new Error("Unexpected store");
      }
    };
    return originalLoad.call(this, id, parent, isMain);
  };
  try {
    delete require.cache[require.resolve("../netlify/functions/lib/arcadeBookingProof.js")];
    delete require.cache[require.resolve("../netlify/functions/arcadeLeaderboard.js")];
    const api = require("../netlify/functions/arcadeLeaderboard.js");
    const proof = require("../netlify/functions/lib/arcadeBookingProof.js");
    const get = () => api.handler({ httpMethod: "GET" });

    let response = await get();
    assert.equal(response.statusCode, 200);
    let board = JSON.parse(response.body);
    assert.equal(board.entries.length, 1);
    assert.equal(board.entries[0].customerRef, publicCustomerReference(playerKey, secret));
    assert.equal(board.entries[0].town, "Newtownards");
    assert.equal(board.entries[0].points, 550);
    assert.ok(!response.body.includes("Jane"));
    assert.ok(!response.body.includes("Mill Road"));
    assert.ok(!response.body.includes("BT23"));
    assert.ok(!response.body.includes(email));
    assert.ok(!("name" in board.entries[0]));
    assert.ok(!("displayName" in board.entries[0]));
    assert.ok(!publicData.has("leaderboard:top10:v2"));
    assert.ok(!("displayName" in publicData.get(recordKey)), "legacy public name was scrubbed");
    assert.equal(publicData.get(recordKey).points, 550);

    // The new cache must not serve the legacy v2 name payload.
    response = await get();
    assert.equal(response.statusCode, 200);
    assert.ok(!response.body.includes("Jane"));

    const bookingProof = proof.signBooking({
      bookingId: "NBG-EXAMPLE-55667788", name: "Jane Private Example",
      email, address: "12 Newtownards Road, Bangor, BT20 5AA",
      phone: "07123456789", bins: [{ type: "Black Bin", count: 1, planId: "domestic_4w" }]
    });
    response = await api.handler({
      httpMethod: "POST",
      body: JSON.stringify({ consent: true, bookingProof, claimed: [] })
    });
    assert.equal(response.statusCode, 200);
    const reg = JSON.parse(response.body);
    assert.equal(reg.customerRef, board.entries[0].customerRef);
    assert.equal(reg.town, "Bangor");
    assert.equal(reg.points, 700);
    assert.ok(!("displayName" in reg));
    assert.ok(!response.body.includes("Jane"));
    assert.ok(!response.body.includes(email));
    assert.ok(!("displayName" in publicData.get(recordKey)));
    assert.deepEqual(Object.keys(publicData.get(recordKey)).sort(),
      ["createdAt", "customerRef", "lastUpdatedAt", "points", "town"].sort());
    assert.equal(privateData.get(recordKey).name, "Jane Private Example");

    const token = reg.playerToken;
    response = await api.handler({
      httpMethod: "POST",
      body: JSON.stringify({ action: "sync", playerToken: token, claimed: ["a:coverage"] })
    });
    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(response.body).points, 725);
    assert.ok(!("displayName" in publicData.get(recordKey)));

    const latest = JSON.parse((await get()).body);
    assert.equal(latest.entries[0].town, "Bangor");
    assert.equal(latest.entries[0].points, 725);
    assert.ok(!JSON.stringify(latest).includes("Jane"));
    assert.ok(!JSON.stringify(latest).includes("Newtownards Road"));

    // Active-only import must NOT publish before the separate owner approval.
    const historic=require("../netlify/functions/lib/squeegeeActiveLeaderboardImport.js");
    const uuid="12345678-1111-4111-8111-123456789abc";
    const ref=historic.canonicalLegacyRef(uuid);
    const sourceAsOf=new Date().toISOString().slice(0,10);
    const statusSnapshot={
      version:2,scoringVersion:"2026-11-streak-20-plus-2-squeegee-skip-reset-v1",
      asOf:sourceAsOf,importedAt:new Date().toISOString(),
      published:false,
      accounts:[{id:uuid,ref,town:"Bangor",paidCleans:1,historicalPoints:20,active:true}]
    };
    historyData.set(historic.SNAPSHOT_KEY,statusSnapshot);
    assert.equal(JSON.parse((await get()).body).entries[0].points,725);

    // A published active customer enters ONCE, without website XP until the
    // separately verified, private Squeegee UUID link exists.
    historyData.set(historic.PUBLISHED_KEY,{...statusSnapshot,published:true});
    response=await get();
    let historicBoard=JSON.parse(response.body);
    assert.equal(response.statusCode,200);
    assert.equal(historicBoard.totalPlayers,1);
    assert.equal(historicBoard.entries[0].customerRef,ref);
    assert.equal(historicBoard.entries[0].town,"Bangor");
    assert.equal(historicBoard.entries[0].points,20);
    assert.equal(historicBoard.sourceAsOf,sourceAsOf);
    assert.ok(!response.body.includes(uuid));
    assert.ok(!response.body.includes("Jane"));

    linkData.set(recordKey,{squeegeeId:uuid,verified:true});
    response=await get();
    historicBoard=JSON.parse(response.body);
    assert.equal(historicBoard.totalPlayers,1);
    assert.equal(historicBoard.entries[0].points,745);
    assert.equal(historicBoard.entries[0].customerRef,ref);
    assert.equal(historicBoard.entries.length,1);
    assert.ok(!response.body.includes(uuid));
    assert.ok(!response.body.includes("Jane"));

    // An out-of-date active account snapshot cannot continue ranking someone
    // who might have since been deactivated in Squeegee.
    historyData.set(historic.PUBLISHED_KEY,{
      ...statusSnapshot,asOf:"2025-01-01",published:true
    });
    const stale=JSON.parse((await get()).body);
    assert.equal(stale.entries.length,0);
    assert.equal(stale.status,"active_status_refresh_required");
    historyData.delete(historic.PUBLISHED_KEY);
    historyData.set(historic.MODE_KEY,{activeOnly:true});
    const unpublished=JSON.parse((await get()).body);
    assert.equal(unpublished.entries.length,0);
    assert.equal(unpublished.totalPlayers,0);
    assert.equal(unpublished.status,"active_status_refresh_required");
  } finally {
    Module._load = originalLoad;
    if (envSecret === undefined) delete process.env.N64_PREVIEW_LEADERBOARD_SECRET;
    else process.env.N64_PREVIEW_LEADERBOARD_SECRET = envSecret;
    if (envResend === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = envResend;
  }
});
