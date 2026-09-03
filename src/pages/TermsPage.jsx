import React from "react";
import { Link } from "react-router-dom";

const sections = [
  {
    title: "1) Service & Contracts",
    items: [
      "Regular 4-weekly plans are based on a 13-clean minimum term, which is approximately 12 months, unless agreed otherwise.",
      "One-off cleans have no minimum term.",
      "Each bin is treated separately; adding another bin may start a new agreement for that bin.",
      "Bookings and plans are not transferable without our agreement.",
    ],
  },
  {
    title: "2) Bin Availability",
    items: [
      "Bins must be left out or made accessible on the scheduled cleaning day and must remain available until 8pm.",
      "If your bin is not available when we attend, or access is blocked, the clean will still be charged.",
      "If we are unable to attend on the scheduled day, we will notify you and rearrange the clean as soon as reasonably possible.",
      "We may be unable to clean if the bin has not been emptied by the council, is too heavy to move safely, or contains unsafe or excessive waste.",
    ],
  },
  {
    title: "3) Cancellations & Minimum Term",
    items: [
      "One-off cleans may be cancelled up to 24 hours before the scheduled clean day without charge.",
      "If a one-off clean is cancelled with less than 24 hours' notice, or the bin is not available when we attend, the clean may still be charged in full.",
      "A 4-weekly plan may be cancelled any time up to 24 hours before the second scheduled clean. If cancelled before the second clean, the first clean will be charged at the standard one-off clean price, and any difference between the 4-weekly price and one-off price will become payable.",
      "After the second clean, the 4-weekly plan continues for the full 13-clean minimum term.",
      "If the customer cancels before the end of the 13-clean minimum term, they will remain liable for the outstanding balance for the remaining cleans within the 12-month minimum term.",
      "After the 13-clean minimum term has been completed, the plan continues on a rolling basis and may be cancelled by giving at least 30 days' notice.",
    ],
  },
  {
    title: "4) One-Off Cleans & Animal Waste",
    items: [
      "One-off cleans containing dog faeces, cat litter, animal bedding, or other animal faeces/waste will incur a £5 surcharge per affected bin.",
      "We may refuse to clean bins containing excessive animal waste, hazardous waste, sharp items, medical waste, chemicals, paint, oil, rubble, hot ashes, or anything unsafe.",
    ],
  },
  {
    title: "5) Cleaning Process",
    items: [
      "Bins are cleaned inside and outside where safe using pressurised water and detergent.",
      "Some stains, ingrained smells, paint, tar, or long-term residue may take multiple visits or may not fully remove.",
      "Any loosened waste may be bagged and left in your bin for disposal.",
      "Please keep at least 5 metres away during cleaning.",
    ],
  },
  {
    title: "6) Payments",
    items: [
      "Payment is due within 7 days of each clean unless agreed otherwise.",
      "Accepted payment methods are Direct Debit, Bank Transfer, and Card. No cash.",
      "Cancelling a Direct Debit does not cancel your service or contract. Cancellation must be requested directly with Ni Bin Guy.",
      "If a 4-weekly plan is cancelled early, any outstanding balance due under the minimum term may still be payable.",
      "Overdue accounts may result in service being stopped and may be referred for recovery.",
    ],
  },
  {
    title: "7) Customer Responsibilities",
    items: [
      "Please keep your contact details, address, and payment details up to date.",
      "Please tell us in advance if your bin will not be available.",
      "Please make sure gates are unlocked, access is safe, and pets are secured where needed.",
      "By booking, you authorise Ni Bin Guy to use a suitable external water tap at the service address, where available, to refill our cleaning tank or equipment as reasonably required to carry out the service.",
      "We have zero tolerance for abuse, threats, or harassment toward staff, including online abuse.",
    ],
  },
  {
    title: "8) Other Terms",
    items: [
      "We may place a small sticker or service tag on your bin.",
      "Discounts are discretionary and may be withdrawn or changed.",
      "Prices may change outside of any agreed fixed term.",
    ],
  },
  {
    title: "9) Data & Communication",
    items: [
      "You consent to us storing your details and contacting you about your booking, schedule, payment, and service.",
      "Text reminders are a courtesy only. You remain responsible for knowing your scheduled clean date.",
    ],
  },
];

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <header className="border-b-4 border-yellow-400 bg-black">
        <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8">
          <p className="mb-2 text-sm font-bold uppercase tracking-[0.18em] text-yellow-400">Ni Bin Guy</p>
          <h1 className="text-3xl font-black sm:text-5xl">Terms of Service</h1>
          <p className="mt-3 text-sm text-neutral-300">Version: August 2026</p>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
        <div className="mb-8 rounded-xl border border-yellow-400/40 bg-yellow-400 px-5 py-4 text-black">
          <p className="font-bold">We keep our Terms of Service simple and transparent.</p>
          <p className="mt-1">By booking or receiving a bin clean from Ni Bin Guy, you agree to the terms below.</p>
        </div>

        <div className="space-y-8">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="mb-3 border-l-4 border-yellow-400 pl-3 text-xl font-extrabold">{section.title}</h2>
              <ul className="space-y-2 text-base leading-7 text-neutral-200">
                {section.items.map((item) => (
                  <li key={item} className="flex gap-3">
                    <span aria-hidden="true" className="mt-3 h-1.5 w-1.5 flex-none rounded-full bg-yellow-400" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="mt-12 border-t border-neutral-800 pt-7">
          <p className="text-2xl font-black text-yellow-400">DIRTY BINS. SORTED.</p>
          <p className="mt-2 text-neutral-300">Thank you for choosing Ni Bin Guy.</p>
          <p className="mt-4 text-sm text-neutral-400">nibing.uy · 07555 178484 · info@nibing.uy</p>
          <Link to="/" className="mt-7 inline-block font-bold text-yellow-400 underline underline-offset-4">
            Back to NI Bin Guy
          </Link>
        </div>
      </div>
    </main>
  );
}
