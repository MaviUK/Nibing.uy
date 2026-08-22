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
const validationState = new WeakMap();
let validationTimer = null;
let validationSequence = 0;

function extractPostcode(address) {
  const match = String(address || "").toUpperCase().match(UK_POSTCODE_RE);
  if (!match) return "";
  const compact = match[1].replace(/\s+/g, "");
  return compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
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
  const heading = Array.from(document.querySelectorAll("h2")).find((node) => /book a bin clean/i.test(node.textContent || ""));
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
  if (panel.dataset.serviceAreaView === view && panel.className === className && panel.innerHTML === html) return;
  panel.dataset.serviceAreaView = view;
  if (panel.className !== className) panel.className = className;
  if (panel.innerHTML !== html) panel.innerHTML = html;
}

function showChecking(root) {
  renderGuardPanel(
    root,
    "checking",
    "mt-3 rounded-xl border px-4 py-3 text-sm border-gray-300 bg-gray-50 text-gray-800",
    '<div style="display:flex;align-items:center;justify-content:center;gap:12px;min-height:54px;"><div aria-hidden="true" style="width:26px;height:26px;border:3px solid #d1d5db;border-top-color:#16a34a;border-radius:9999px;animation:nbgAddressSpin .8s linear infinite;"></div><strong>Checking your address…</strong></div><style>@keyframes nbgAddressSpin{to{transform:rotate(360deg)}}</style>'
  );
}

function showInvalidAddress(root) {
  renderGuardPanel(
    root,
    "invalid",
    "mt-3 rounded-xl border px-4 py-3 text-sm border-amber-400 bg-amber-50 text-amber-900",
    '<div class="font-bold">Please enter your full address.</div><div class="mt-1 text-xs leading-5">Select your address from the suggestions and make sure the postcode is included.</div>'
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

function setState(root, status, extras = {}) {
  const next = { status, town: "", address: "", ...extras };
  validationState.set(root, next);
  root.dataset.addressValidation = status;
  root.dataset.outsideServiceArea = status === "outside" ? "true" : "false";
  root.dataset.coveredTown = next.town || "";
  return next;
}

function componentNames(result) {
  return (result?.address_components || []).map((component) => component.long_name).filter(Boolean);
}

function hasFullStreetAddress(result) {
  const components = result?.address_components || [];
  const types = new Set(components.flatMap((component) => component.types || []));
  const hasNumber = types.has("street_number") || types.has("premise") || types.has("subpremise");
  const hasStreet = types.has("route");
  return hasNumber && hasStreet;
}

function resolveWithGoogle(address) {
  return new Promise((resolve) => {
    if (!window.google?.maps?.Geocoder) {
      resolve(null);
      return;
    }
    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode({ address, componentRestrictions: { country: "GB" } }, (results, status) => {
      if (status !== "OK" || !Array.isArray(results) || !results.length) {
        resolve([]);
        return;
      }
      resolve(results);
    });
  });
}

async function validateResolvedAddress(root, forceMessage = false) {
  if (!root) return false;
  const address = String(getAddressInput(root)?.value || "").trim();
  const sequence = ++validationSequence;

  if (!address) {
    setState(root, "idle", { address });
    return false;
  }

  if (address.length < 7) {
    setState(root, "invalid", { address });
    if (forceMessage || address.length > 5) showInvalidAddress(root);
    return false;
  }

  setState(root, "checking", { address });
  showChecking(root);

  const results = await resolveWithGoogle(address);
  if (sequence !== validationSequence) return false;

  if (results === null) {
    const postcode = extractPostcode(address);
    const typedTown = findCoveredTown(address);
    if (postcode && typedTown) {
      setState(root, "covered", { address, town: typedTown });
      return true;
    }
    setState(root, "invalid", { address });
    showInvalidAddress(root);
    return false;
  }

  if (!results.length) {
    setState(root, "invalid", { address });
    showInvalidAddress(root);
    return false;
  }

  const resolved = results[0];
  const resolvedPostcode = componentNames(resolved).find((name) => extractPostcode(name)) || extractPostcode(resolved.formatted_address || "");
  if (!resolvedPostcode || !hasFullStreetAddress(resolved)) {
    setState(root, "invalid", { address });
    showInvalidAddress(root);
    return false;
  }

  const searchable = [resolved.formatted_address || "", ...componentNames(resolved)].join(" ");
  const town = findCoveredTown(searchable);
  if (!town) {
    setState(root, "outside", { address });
    showOutOfArea(root);
    return false;
  }

  setState(root, "covered", { address, town });
  return true;
}

function scheduleValidation(root, delay = 700) {
  window.clearTimeout(validationTimer);
  validationTimer = window.setTimeout(() => validateResolvedAddress(root, false), delay);
}

function enforceVisibleState(root) {
  const state = validationState.get(root);
  if (!state) return;
  if (state.status === "outside") showOutOfArea(root);
  if (state.status === "invalid") showInvalidAddress(root);
  if (state.status === "checking") showChecking(root);
}

function revalidateIfAddressChanged(root, delay = 50) {
  const address = String(getAddressInput(root)?.value || "").trim();
  const state = validationState.get(root);
  if (!state || state.address !== address) scheduleValidation(root, delay);
}

function bind(root) {
  if (!root || root.dataset.serviceAreaGuardBound === "true") return;
  root.dataset.serviceAreaGuardBound = "true";
  setState(root, "idle");

  const observer = new MutationObserver(() => enforceVisibleState(root));
  observer.observe(root, { childList: true, subtree: true });

  root.addEventListener("input", (event) => {
    if (event.target === getAddressInput(root)) scheduleValidation(root);
  }, true);
  root.addEventListener("change", (event) => {
    if (event.target === getAddressInput(root)) scheduleValidation(root, 100);
  }, true);
  root.addEventListener("focusout", (event) => {
    if (event.target === getAddressInput(root)) {
      window.setTimeout(() => revalidateIfAddressChanged(root, 0), 50);
    }
  }, true);

  root.addEventListener("click", async (event) => {
    revalidateIfAddressChanged(root, 50);

    const button = event.target?.closest?.("button");
    if (!button || !/send via whatsapp|send via email/i.test(String(button.textContent || ""))) return;

    const state = validationState.get(root);
    if (state?.status === "covered" && state.address === String(getAddressInput(root)?.value || "").trim()) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    const valid = await validateResolvedAddress(root, true);
    if (!valid) getAddressInput(root)?.focus();
  }, true);

  scheduleValidation(root);
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
