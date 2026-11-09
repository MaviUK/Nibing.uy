import React from "react";

// Keep the approved terms in bookingTerms.json. This component only changes
// their presentation so each numbered section is easy to scan on a phone.
export default function BookingTermsContent({ body }) {
  const blocks = [];
  for (const rawLine of String(body || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^[-•]\s+/.test(line)) {
      if (blocks[blocks.length - 1]?.kind !== "list") {
        blocks.push({ kind: "list", items: [] });
      }
      blocks[blocks.length - 1].items.push(line.replace(/^[-•]\s+/, ""));
    } else if (/^\d+\)\s+/.test(line)) {
      blocks.push({ kind: "heading", text: line });
    } else {
      blocks.push({ kind: "paragraph", text: line });
    }
  }

  return (
    <div className="space-y-3 text-[15px] leading-6 text-slate-800 sm:space-y-4 sm:text-base">
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          return (
            <h3 key={index} className="pt-2 text-[16px] font-extrabold leading-snug text-slate-950 sm:text-lg">
              {block.text}
            </h3>
          );
        }
        if (block.kind === "list") {
          return (
            <ul key={index} className="list-disc space-y-1.5 pl-5 marker:text-slate-500">
              {block.items.map((item, itemIndex) => <li key={itemIndex} className="pl-0.5">{item}</li>)}
            </ul>
          );
        }
        return <p key={index}>{block.text}</p>;
      })}
    </div>
  );
}
