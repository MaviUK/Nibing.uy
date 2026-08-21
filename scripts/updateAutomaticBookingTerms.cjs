const { readFileSync, writeFileSync } = require("fs");
const { resolve } = require("path");

const VERSION = "August 2026";

const FULL_TERMS = `We keep our Terms of Service simple and transparent. By booking or receiving a bin clean from Ni Bin Guy, you agree to:

1) Service & Contracts
• Regular 4-weekly plans are based on a 13-clean minimum term, which is approximately 12 months, unless agreed otherwise.
• One-off cleans have no minimum term.
• Each bin is treated separately; adding another bin may start a new agreement for that bin.
• Bookings and plans are not transferable without our agreement.

2) Bin Availability
• Bins must be left out or made accessible on the scheduled cleaning day and must remain available until 8pm.
• If your bin is not available when we attend, or access is blocked, the clean will still be charged.
• If we are unable to attend on the scheduled day, we will notify you and rearrange the clean as soon as reasonably possible.
• We may be unable to clean if the bin has not been emptied by the council, is too heavy to move safely, or contains unsafe or excessive waste.

3) Cancellations & Minimum Term
• One-off cleans may be cancelled up to 24 hours before the scheduled clean day without charge.
• If a one-off clean is cancelled with less than 24 hours’ notice, or the bin is not available when we attend, the clean may still be charged in full.
• A 4-weekly plan may be cancelled any time up to 24 hours before the second scheduled clean. If cancelled before the second clean, the first clean will be charged at the standard one-off clean price, and any difference between the 4-weekly price and one-off price will become payable.
• After the second clean, the 4-weekly plan continues for the full 13-clean minimum term.
• If the customer cancels before the end of the 13-clean minimum term, they will remain liable for the outstanding balance for the remaining cleans within the 12-month minimum term.
• After the 13-clean minimum term has been completed, the plan continues on a rolling basis and may be cancelled by giving at least 30 days’ notice.

4) One-Off Cleans & Animal Waste
• One-off cleans containing dog faeces, cat litter, animal bedding, or other animal faeces/waste will incur a £5 surcharge per affected bin.
• We may refuse to clean bins containing excessive animal waste, hazardous waste, sharp items, medical waste, chemicals, paint, oil, rubble, hot ashes, or anything unsafe.

5) Cleaning Process
• Bins are cleaned inside and outside where safe using pressurised water and detergent.
• Some stains, ingrained smells, paint, tar, or long-term residue may take multiple visits or may not fully remove.
• Any loosened waste may be bagged and left in your bin for disposal.
• Please keep at least 5 metres away during cleaning.

6) Payments
• Payment is due within 7 days of each clean unless agreed otherwise.
• Accepted payment methods are Direct Debit, Bank Transfer, and Card. No cash.
• Cancelling a Direct Debit does not cancel your service or contract. Cancellation must be requested directly with Ni Bin Guy.
• If a 4-weekly plan is cancelled early, any outstanding balance due under the minimum term may still be payable.
• Overdue accounts may result in service being stopped and may be referred for recovery.

7) Customer Responsibilities
• Please keep your contact details, address, and payment details up to date.
• Please tell us in advance if your bin will not be available.
• Please make sure gates are unlocked, access is safe, and pets are secured where needed.
• By booking, you authorise Ni Bin Guy to use a suitable external water tap at the service address, where available, to refill our cleaning tank or equipment as reasonably required to carry out the service.
• We have zero tolerance for abuse, threats, or harassment toward staff, including online abuse.

8) Other Terms
• We may place a small sticker or service tag on your bin.
• Discounts are discretionary and may be withdrawn or changed.
• Prices may change outside of any agreed fixed term.

9) Data & Communication
• You consent to us storing your details and contacting you about your booking, schedule, payment, and service.
• Text reminders are a courtesy only. You remain responsible for knowing your scheduled clean date.`;

const filePath = resolve(process.cwd(), "netlify/functions/sendAutomaticBookingConfirmation.js");
const before = readFileSync(filePath, "utf8");
let after = before.replace(/const TERMS_VERSION_DEFAULT = "[^"]+";/, `const TERMS_VERSION_DEFAULT = "${VERSION}";`);
after = after.replace(/const TERMS_BODY = `.*?`;/s, `const TERMS_BODY = \`\nNi Bin Guy – Terms of Service\n\n${FULL_TERMS}\n\`;`);

if (!after.includes("const BIN_JOKES = [")) {
  const jokeCode = `
const BIN_JOKES = [
  ["Why did the wheelie bin go to therapy?", "It had too much rubbish to deal with."],
  ["What did one bin say to the other?", "You look rubbish."],
  ["Why was the bin embarrassed?", "Everyone kept talking trash about it."],
  ["What's a wheelie bin's favourite music?", "Heavy metal."],
  ["What did the clean bin say to the dirty bin?", "You scrub up well."],
  ["Why don't bins tell secrets?", "They always end up spilling the rubbish."],
  ["What's a bin's favourite day?", "Throwback Thursday."],
  ["Why did the bin cross the road?", "Because someone forgot to bring it back in."],
  ["What do you call a bin that tells bad jokes?", "A waste of comedy."],
  ["Why was the wheelie bin exhausted?", "It was completely trashed."],
  ["Why are wheelie bins terrible at hide-and-seek?", "They're always left out."],
  ["Why did the bin break up with the rubbish bag?", "The relationship was toxic."],
  ["Why did the wheelie bin blush?", "Someone lifted its lid."],
  ["Why did the wheelie bin refuse dessert?", "It was already stuffed."],
  ["Why did the rubbish bin get arrested?", "It was caught littering."],
  ["Why did the bin become a comedian?", "It had loads of material."],
  ["What do you call a wheelie bin with no wheels?", "A drag."],
  ["Why did the bin go on a diet?", "Too much junk food."],
  ["What did the bin say to the bin lorry?", "You pick me up every time I'm feeling down."],
  ["Why did the wheelie bin get a makeover?", "It wanted to clean up its act."],
  ["What did the bin say after being pressure washed?", "That was wheelie refreshing."],
  ["Why are bins so good at listening?", "You can dump anything on them."],
  ["Why did the wheelie bin start exercising?", "It wanted to lose some waste."],
  ["What did the dirty bin say when Ni Bin Guy arrived?", "Oh rubbish... he found me."],
  ["Why was the wheelie bin popular at parties?", "It could handle everyone's rubbish."],
  ["Why did the bin book a spa day?", "It needed a good scrub."],
  ["What did the bin say after Ni Bin Guy finished?", "That's a weight off my lid."],
  ["Why did the wheelie bin get an award?", "For outstanding waste management."],
  ["What does a bin say before a big clean?", "Time to get my act together."],
  ["Why was the bin always calm?", "It knew how to let things go."],
  ["What's a wheelie bin's favourite dance?", "The trash can-can."],
  ["Why did the bin refuse to argue?", "It didn't want to talk rubbish."],
  ["Why was the wheelie bin so confident?", "It knew it was wheelie good."],
  ["What do bins do on holiday?", "They take some time to unwind and de-compose."],
  ["Why did the bin get a new lid?", "It needed a fresh outlook."],
  ["What did the bin say on collection morning?", "Today's my pick-up day."],
  ["Why did the bin avoid gossip?", "Too much trash talk."],
  ["What's a bin's favourite compliment?", "You clean up nicely."],
  ["Why was the dirty bin nervous?", "Ni Bin Guy was on the way."],
  ["What did one sparkling clean bin say to another?", "We're looking wheelie fresh."],
];
function randomBinJoke() {
  return BIN_JOKES[Math.floor(Math.random() * BIN_JOKES.length)];
}
`;
  after = after.replace("exports.handler = async (event) => {", `${jokeCode}\nexports.handler = async (event) => {`);
}

if (!after.includes("const [jokeQuestion, jokeAnswer] = randomBinJoke();")) {
  after = after.replace(
    "    const priceLines = Array.isArray(pricing?.lines) ? pricing.lines : [];",
    "    const priceLines = Array.isArray(pricing?.lines) ? pricing.lines : [];\n    const [jokeQuestion, jokeAnswer] = randomBinJoke();"
  );
}

if (!after.includes("TODAY'S RUBBISH JOKE")) {
  const jokeBlock = `
            <tr><td style="padding:14px 26px 0;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0b6b44;border:1px solid #14865b;border-radius:14px;"><tr><td style="padding:18px 20px;text-align:center;">
              <div style="font-family:Arial Black,Arial,sans-serif;color:#fff;font-size:17px;font-weight:900;text-transform:uppercase;">🗑 TODAY'S RUBBISH JOKE</div>
              <div style="font-family:Arial,sans-serif;color:#fff;font-size:14px;line-height:1.5;margin-top:8px;font-weight:700;">\${escapeHtml(jokeQuestion)}</div>
              <div style="font-family:Arial,sans-serif;color:#ffd400;font-size:14px;line-height:1.5;margin-top:4px;font-weight:800;">\${escapeHtml(jokeAnswer)} 😄</div>
            </td></tr></table></td></tr>
`;
  after = after.replace(
    '            <tr><td style="padding:26px;text-align:center;background:#050505;">',
    `${jokeBlock}\n            <tr><td style="padding:26px;text-align:center;background:#050505;">`
  );
}

if (after !== before) {
  writeFileSync(filePath, after, "utf8");
  console.log("Updated automatic booking confirmation terms and rubbish joke");
} else {
  console.log("Automatic booking confirmation already up to date");
}
