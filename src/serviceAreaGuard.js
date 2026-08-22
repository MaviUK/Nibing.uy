const SERVICE_OUTCODES = new Set(["BT18", "BT19", "BT20", "BT21", "BT22", "BT23"]);

function extractPostcode(address) {
  const match = String(address || "").toUpperCase().match(/\b(BT\d{1,2}[A-Z]?\s*\d[A-Z]{2})\b/i);
  if (!match) return "";
  const compact = match[1].replace(/\s+/g, "");
  return compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
}

function isCoveredPostcode(postcode) {
  const outcode = String(postcode || "").trim().toUpperCase().split(/\s+/)[0];
  return SERVICE_OUTCODES.has(outcode);
}

function findBookingRoot() {
  const heading = Array.from(document.querySelectorAll("h2")).find((node) => /book a bin clean/i.test(node.textContent || ""));
  return heading?.closest(".p-6") || heading?.parentElement || null;
}

function getAddressInput(root) {
  return root?.querySelector('input[placeholder="Full Address"]') || null;
}

function showOutOfArea(root) {
  const panel = root?.querySelector("[data-auto-schedule-panel]");
  if (!panel) return;
  panel.className = "mt-3 rounded-xl border px-4 py-3 text-sm border-red-400 bg-red-50 text-red-900";
  panel.innerHTML = '<div class="font-bold">Sorry, we do not cover your area yet.</div><div class="mt-1 text-xs leading-5">Please check back with us in future as our service area expands.</div>';
}

function currentState(root) {
  const address = String(getAddressInput(root)?.value || "").trim();
  const postcode = extractPostcode(address);
  return { address, postcode, outside: Boolean(postcode && !isCoveredPostcode(postcode)) };
}

function enforce(root) {
  if (!root) return;
  const state = currentState(root);
  root.dataset.outsideServiceArea = state.outside ? "true" : "false";
  if (state.outside) showOutOfArea(root);
}

function bind(root) {
  if (!root || root.dataset.serviceAreaGuardBound === "true") return;
  root.dataset.serviceAreaGuardBound = "true";

  const observer = new MutationObserver(() => {
    if (root.dataset.outsideServiceArea === "true") showOutOfArea(root);
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true });

  root.addEventListener("input", () => window.setTimeout(() => enforce(root), 0), true);
  root.addEventListener("change", () => window.setTimeout(() => enforce(root), 0), true);

  root.addEventListener("click", (event) => {
    const button = event.target?.closest?.("button");
    if (!button || !/send via whatsapp|send via email/i.test(String(button.textContent || ""))) return;
    const state = currentState(root);
    if (!state.outside) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    root.dataset.outsideServiceArea = "true";
    showOutOfArea(root);
    getAddressInput(root)?.focus();
  }, true);

  enforce(root);
}

function tryBind() {
  const root = findBookingRoot();
  if (root) bind(root);
}

document.addEventListener("click", (event) => {
  const target = event.target?.closest?.("button, a");
  if (!target) return;
  const text = String(target.textContent || "").trim();
  if (/book a clean|book a bin clean/i.test(text) || target.dataset?.openBookingForm === "true") {
    window.setTimeout(tryBind, 0);
    window.setTimeout(tryBind, 100);
  }
}, true);
