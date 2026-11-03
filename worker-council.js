// worker-council.js
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Your rota (you already have FOUR_WEEK_PLAN in your codebase; import it here instead)
// Placeholder shape: FOUR_WEEK_PLAN[weekIndex][dayName] => { area: "Bangor", ... }
import { FOUR_WEEK_PLAN, getWeekIndexForDate } from "./rota.js"; // you’ll add this

function pickEarliestRelevantEmptyDate(extracted, binsRequested) {
  // extracted example we will store:
  // { black: ["2026-02-17", ...], blue: [...], brown: [...], green: [...] }
  const wanted = [];
  for (const [bin, meta] of Object.entries(binsRequested || {})) {
    if (!meta?.qty) continue;
    const next = extracted?.[bin]?.[0];
    if (next) wanted.push(next);
  }
  if (!wanted.length) return null;
  wanted.sort(); // ISO date strings sort correctly
  return wanted[0];
}

function findNextCoveredCleanDate(startDateISO, customerArea) {
  // rule: clean on/after next empty date (you can change to +1 day if you only clean day-after)
  const start = new Date(startDateISO + "T00:00:00Z");

  for (let i = 0; i < 28; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);

    const day = d.getUTCDay(); // 0 Sun ... 6 Sat
    const dayName = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][day];
    if (!["Mon","Tue","Wed","Thu"].includes(dayName)) continue;

    const weekIndex = getWeekIndexForDate(d); // 0..3
    const rotaDay = FOUR_WEEK_PLAN[weekIndex]?.[dayName];
    if (!rotaDay) continue;

    // simple matching: exact match OR rota area contains customer area label
    const rotaArea = rotaDay.area;
    const ok =
      rotaArea === customerArea ||
      (rotaArea && customerArea && rotaArea.toLowerCase().includes(customerArea.toLowerCase()));

    if (ok) {
      const iso = d.toISOString().slice(0, 10);
      return { iso, rotaArea };
    }
  }

  return null;
}

async function lookupCouncilDates(page, addressFormatted) {
  await page.goto("https://collections-ardsandnorthdown.azurewebsites.net/calendar.html", {
    waitUntil: "domcontentloaded",
  });

  // NOTE: selectors can differ; easiest is to lock them in with Playwright codegen.
  // We’ll assume there is a search input + a suggestion list.
  await page.getByRole("textbox").fill(addressFormatted);
  await page.waitForTimeout(400); // small debounce for suggestions

  // Click the first suggestion (adjust selector after codegen if needed)
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");

  // Wait for the calendar graphics element (you previously used divCalendarGraphics)
  await page.waitForSelector("#divCalendarGraphics", { timeout: 15000 });

  // Extract next dates. This is site-specific; we’ll parse visible text and normalise dates.
  // You will tune parsing once we capture the actual rendered HTML in your environment.
  const rawText = await page.locator("#divCalendarGraphics").innerText();

  // TODO: implement a robust parser for your specific output.
  // For now, store rawText and return empty dates; next step is we replace this with real parsing.
  return { rawText, dates: {} };
}

function mapAddressToArea({ postcode, locality }) {
  // You can refine this over time. Start simple.
  const pc = (postcode || "").toUpperCase().replace(/\s+/g, "");
  const town = (locality || "").toLowerCase();

  if (town.includes("bangor") || pc.startsWith("BT20") || pc.startsWith("BT19")) return "Bangor";
  if (town.includes("comber") || pc.startsWith("BT23")) return "Comber";
  if (town.includes("portavogie")) return "Portavogie";
  if (town.includes("cloughey")) return "Cloughey";
  if (town.includes("portaferry") || pc.startsWith("BT22")) return "Portaferry";

  return "Unknown";
}

async function getNextBooking() {
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("status", "new")
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) throw error;
  return data?.[0] || null;
}

async function updateBooking(id, patch) {
  const { error } = await supabase.from("bookings").update(patch).eq("id", id);
  if (error) throw error;
}

async function loop() {
  while (true) {
    const b = await getNextBooking();
    if (!b) {
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }

    await updateBooking(b.id, { status: "processing", error_message: null });

    const browser = await chromium.launch({ headless: true });
    const page = await (await browser.newContext()).newPage();

    try {
      const customerArea = mapAddressToArea({ postcode: b.postcode, locality: b.locality });

      const council = await lookupCouncilDates(page, b.address_formatted);

      // Once parsing is implemented, council.dates will have next ISO dates per bin colour.
      const earliest = pickEarliestRelevantEmptyDate(council.dates, b.bins);

      // TEMP behaviour until parsing is plugged in:
      // If earliest is null, reject with “could not determine dates”.
      if (!earliest) {
        await updateBooking(b.id, {
          status: "failed",
          council_lookup: council,
          proposed_area: customerArea,
          error_message: "Could not determine next empty dates from council calendar.",
        });
        await browser.close();
        continue;
      }

      const match = findNextCoveredCleanDate(earliest, customerArea);

      if (!match) {
        await updateBooking(b.id, {
          status: "rejected",
          council_lookup: council,
          next_empty_date: earliest,
          proposed_area: customerArea,
          error_message: "No rota coverage in next 28 days for this area.",
        });
        await browser.close();
        continue;
      }

      await updateBooking(b.id, {
        status: "approved_for_quote",
        council_lookup: council,
        next_empty_date: earliest,
        proposed_clean_date: match.iso,
        proposed_area: match.rotaArea,
      });

      await browser.close();
    } catch (e) {
      await updateBooking(b.id, { status: "failed", error_message: e.message });
      await browser.close();
    }
  }
}

loop().catch((e) => {
  console.error(e);
  process.exit(1);
});