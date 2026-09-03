import * as pdfLib from "pdf-lib";
import termsPdfModule from "./lib/termsPdf.js";

// Keep pdf-lib as a direct dependency of this ESM function so Netlify's bundler
// includes it in the function package. termsPdf.js is CommonJS and also uses it.
void pdfLib.PDFDocument;

const { buildTermsAcceptancePdfAttachment } = termsPdfModule;

const TERMS_BODY = `We keep our Terms of Service simple and transparent. By booking or receiving a bin clean from Ni Bin Guy, you agree to:

1) Service & Contracts
- Regular 4-weekly plans are based on a 13-clean minimum term, which is approximately 12 months, unless agreed otherwise.
- One-off cleans have no minimum term.
- Each bin is treated separately; adding another bin may start a new agreement for that bin.
- Bookings and plans are not transferable without our agreement.

2) Bin Availability
- Bins must be left out or made accessible on the scheduled cleaning day and must remain available until 8pm.
- If your bin is not available when we attend, or access is blocked, the clean will still be charged.
- If we are unable to attend on the scheduled day, we will notify you and rearrange the clean as soon as reasonably possible.
- We may be unable to clean if the bin has not been emptied by the council, is too heavy to move safely, or contains unsafe or excessive waste.

3) Cancellations & Minimum Term
- One-off cleans may be cancelled up to 24 hours before the scheduled clean day without charge.
- If a one-off clean is cancelled with less than 24 hours' notice, or the bin is not available when we attend, the clean may still be charged in full.
- A 4-weekly plan may be cancelled any time up to 24 hours before the second scheduled clean. If cancelled before the second clean, the first clean will be charged at the standard one-off clean price, and any difference between the 4-weekly price and one-off price will become payable.
- After the second clean, the 4-weekly plan continues for the full 13-clean minimum term.
- If the customer cancels before the end of the 13-clean minimum term, they will remain liable for the outstanding balance for the remaining cleans within the 12-month minimum term.
- After the 13-clean minimum term has been completed, the plan continues on a rolling basis and may be cancelled by giving at least 30 days' notice.

4) One-Off Cleans & Animal Waste
- One-off cleans containing dog faeces, cat litter, animal bedding, or other animal faeces/waste will incur a £5 surcharge per affected bin.
- We may refuse to clean bins containing excessive animal waste, hazardous waste, sharp items, medical waste, chemicals, paint, oil, rubble, hot ashes, or anything unsafe.

5) Cleaning Process
- Bins are cleaned inside and outside where safe using pressurised water and detergent.
- Some stains, ingrained smells, paint, tar, or long-term residue may take multiple visits or may not fully remove.
- Any loosened waste may be bagged and left in your bin for disposal.
- Please keep at least 5 metres away during cleaning.

6) Payments
- Payment is due within 7 days of each clean unless agreed otherwise.
- Accepted payment methods are Direct Debit, Bank Transfer, and Card. No cash.
- Cancelling a Direct Debit does not cancel your service or contract. Cancellation must be requested directly with Ni Bin Guy.
- If a 4-weekly plan is cancelled early, any outstanding balance due under the minimum term may still be payable.
- Overdue accounts may result in service being stopped and may be referred for recovery.

7) Customer Responsibilities
- Please keep your contact details, address, and payment details up to date.
- Please tell us in advance if your bin will not be available.
- Please make sure gates are unlocked, access is safe, and pets are secured where needed.
- By booking, you authorise Ni Bin Guy to use a suitable external water tap at the service address, where available, to refill our cleaning tank or equipment as reasonably required to carry out the service.
- We have zero tolerance for abuse, threats, or harassment toward staff, including online abuse.

8) Other Terms
- We may place a small sticker or service tag on your bin.
- Discounts are discretionary and may be withdrawn or changed.
- Prices may change outside of any agreed fixed term.

9) Data & Communication
- You consent to us storing your details and contacting you about your booking, schedule, payment, and service.
- Text reminders are a courtesy only. You remain responsible for knowing your scheduled clean date.`;

export default async () => {
  const pdf = await buildTermsAcceptancePdfAttachment({
    name: "Evelyn",
    email: "evelyn@gerball.co.uk",
    phone: "07849922479",
    address: "27 Linley Dr, Comber, Newtownards BT23 5DD, UK",
    binsText: "1 x Brown Bin (plan: domestic_4w)",
    pricingText: "Pricing:\n1x Brown - 4 Weekly @ GBP 5 = GBP 5\n\nSubtotal: GBP 5\nTotal: GBP 5\n\nDiscount Code: None",
    termsAccepted: true,
    termsVersion: "August 2026",
    termsAcceptanceText: "I confirm I've read and agree to the Ni Bin Guy Terms of Service (vAugust 2026)",
    termsTimestamp: "2026-09-03T14:09:42.000Z",
    termsBody: TERMS_BODY,
    source: "street-signup",
    verificationHash: "fc92603a4cdd37b2fc2a4eef20fed7bfa5ce6155464775a322cb0ff4644c1d1b",
  });

  const bytes = Buffer.from(pdf.content, "base64");
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${pdf.filename}"`,
      "Cache-Control": "public, max-age=300",
    },
  });
};

export const config = {
  path: "/customer-documents/ni-bin-guy-terms-acceptance-evelyn.pdf",
};
