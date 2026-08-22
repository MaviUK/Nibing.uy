const COVERED_TOWNS = [
  "Bangor",
  "Newtownards",
  "Donaghadee",
  "Comber",
  "Millisle",
  "Ballywalter",
  "Portaferry",
  "Portavogie",
  "Cloughey",
  "Ballyhalbert",
];

const UK_POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;
const UK_OUTWARD_RE = /\b([A-Z]{1,2}\d[A-Z\d]?)\b/i;
const validationState = new WeakMap();
let validationTimer = null;

function extractPostcode(address) {
  const match = String(address || "").toUpperCase().match(UK_POSTCODE_RE);
  if (!match) return "";
  const compact = match[1].replace(/\s+/g, "");
  return compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
}

function extractOutwardCode(address) {
  const match = String(address || "").toUpperCase().match(UK_OUTWARD_RE);
  return match?.[1] || "";
}

function normalise(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[.,'’()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findCoveredTown(value) {
  const haystack = ` ${normalise(value)} `;
  return COVERED_TOWNS.find((town) => haystack.includes(` ${normalise(town)} `)) || "";
}

function findBookingRoot() {
  const heading = Array.from(document.querySelectorAll("h2")).find((node) =>
    /book a bin clean/i.test(node.textContent || "")
  );
  return heading?.closest(".p-6") || heading?.parentElement || null;
}

function getAddressInput(root) {
  return root?.querySelector('input[placeholder="Full Address"]') || null;
}

function getPanel(root) {
  return root?.querySelector("[data-auto-schedule-panel]") || null;
}

function renderGuardPanel(root, view, className, html) {
  const panel = getPanel(root);
  if (!panel) return;
  panel.dataset.serviceAreaView = view;
  panel.className = className;
  panel.innerHTML = html;
}

function showInvalidAddress(root) {
  renderGuardPanel(
    root,
    "invalid",
    "mt-3 rounded-xl border px-4 py-3 text-sm border-amber-400 bg-amber-50 text-amber-900",
    '<div class="font-bold">Please enter your full address including postcode.</div><div class="mt-1 text-xs leading-5">Google suggestions are optional — you can type your address manually as long as the postcode is included.</div>'
  );
}

function showOutOfArea(root) {
  renderGuardPanel(
    root,
    "outside",
    "mt-3 rounded-xl border px-4 py-3 text-sm border-red-400 bg-red-50 text-red-900",
    '<div class="font-bold">Sorry, we do not cover your area yet.</div><div class="mt-1 text-xs leading-5">Please check back with us in future as our service area expands.</div>'
  );
}

function clearGuardWarning(root) {
  const panel = getPanel(root);
  if (!panel || !panel.dataset.serviceAreaView) return;

  delete panel.dataset.serviceAreaView;
  panel.className = "mt-3 rounded-xl border px-4 py-3 text-sm border-gray-200 bg-gray-50 text-gray-800";
  panel.innerHTML = '<div class="font-bold">Next Clean Date</div><div class="mt-1 text-xs leading-5">Please fill in the above to show date.</div>';
}

function setState(root, status, extras = {}) {
  const next = { status, town: "", address: "", ...extras };
  validationState.set(root, next);
  root.dataset.addressValidation = status;
  root.dataset.outsideServiceArea = status === "outside" ? "true" : "false";
  root.dataset.coveredTown = next.town || "";
  return next;
}

function validateAddress(root, forceMessage = false) {
  if (!root) return false;

  const address = String(getAddressInput(root)?.value || "").trim();
  if (!address) {
    setState(root, "idle", { address });
    return false;
  }

  // Reject addresses that are clearly outside Northern Ireland as soon as an
  // outward postcode is visible. Google autocomplete is NOT required.
  const outwardCode = extractOutwardCode(address);
  if (outwardCode && !outwardCode.startsWith("BT")) {
    setState(root, "outside", { address });
    showOutOfArea(root);
    return false;
  }

  const postcode = extractPostcode(address);
  if (!postcode) {
    setState(root, "invalid", { address });
    if (forceMessage || address.length >= 7) showInvalidAddress(root);
    return false;
  }

  // Manual addresses are valid. A customer does not have to select a Google
  // suggestion because new developments may not exist in Google yet. Once a
  // complete BT postcode is present, allow the normal council/schedule lookup
  // to continue. Keep the covered-town value when it is present in the text,
  // but do not require it for manual entry.
  if (!postcode.toUpperCase().startsWith("BT")) {
    setState(root, "outside", { address });
    showOutOfArea(root);
    return false;
  }

  const town = findCoveredTown(address);
  setState(root, "covered", { address, town, postcode, manual: !town });
  clearGuardWarning(root);
  return true;
}

function scheduleValidation(root, delay = 350) {
  window.clearTimeout(validationTimer);
  validationTimer = window.setTimeout(() => validateAddress(root, false), delay);
}

function bind(root) {
  if (!root || root.dataset.serviceAreaGuardBound === "true") return;
  root.dataset.serviceAreaGuardBound = "true";
  setState(root, "idle");

  root.addEventListener(
    "input",
    (event) => {
      if (event.target === getAddressInput(root)) scheduleValidation(root);
    },
    true
  );

  root.addEventListener(
    "change",
    (event) => {
      if (event.target === getAddressInput(root)) scheduleValidation(root, 50);
    },
    true
  );

  root.addEventListener(
    "focusout",
    (event) => {
      if (event.target === getAddressInput(root)) {
        window.setTimeout(() => validateAddress(root, false), 50);
      }
    },
    true
  );

  root.addEventListener(
    "click",
    (event) => {
      const button = event.target?.closest?.("button");
      if (!button || !/send via whatsapp|send via email/i.test(String(button.textContent || ""))) return;

      if (validateAddress(root, true)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      getAddressInput(root)?.focus();
    },
    true
  );

  scheduleValidation(root, 100);
}

function tryBind() {
  const root = findBookingRoot();
  if (root) bind(root);
}

document.addEventListener(
  "click",
  (event) => {
    const target = event.target?.closest?.("button, a");
    if (!target) return;
    const text = String(target.textContent || "").trim();
    if (/book a clean|book a bin clean/i.test(text) || target.dataset?.openBookingForm === "true") {
      window.setTimeout(tryBind, 0);
      window.setTimeout(tryBind, 100);
    }
  },
  true
);
