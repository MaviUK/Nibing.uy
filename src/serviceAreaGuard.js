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

// Common nearby towns/cities that are explicitly outside the current service area.
// This is only an early-rejection aid for manual addresses. Covered towns remain
// the positive source of truth, and postcode validation still handles addresses
// that do not name a town clearly.
const EXPLICIT_UNCOVERED_TOWNS = [
  "Belfast",
  "Lisburn",
  "Holywood",
  "Dundonald",
  "Carryduff",
  "Ballynahinch",
  "Downpatrick",
  "Newcastle",
  "Hillsborough",
  "Moira",
];

const UK_POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;
const UK_OUTWARD_RE = /\b([A-Z]{1,2}\d[A-Z\d]?)\b/i;
const validationState = new WeakMap();
const postcodeTownCache = new Map();
let validationTimer = null;
let validationSequence = 0;

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

function findExplicitUncoveredTown(value) {
  const haystack = ` ${normalise(value)} `;
  return EXPLICIT_UNCOVERED_TOWNS.find((town) => haystack.includes(` ${normalise(town)} `)) || "";
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

function showAreaUnverified(root) {
  renderGuardPanel(
    root,
    "invalid",
    "mt-3 rounded-xl border px-4 py-3 text-sm border-amber-400 bg-amber-50 text-amber-900",
    '<div class="font-bold">We couldn’t verify your service area.</div><div class="mt-1 text-xs leading-5">Please include your town and full postcode in the address, then try again.</div>'
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

function showAreaChecking(root) {
  renderGuardPanel(
    root,
    "checking",
    "mt-3 rounded-xl border px-4 py-3 text-sm border-gray-300 bg-gray-50 text-gray-800",
    '<div style="display:flex;align-items:center;justify-content:center;min-height:74px;"><div aria-label="Checking service area" role="status" style="width:34px;height:34px;border:4px solid #d1d5db;border-top-color:#16a34a;border-radius:9999px;animation:nbgAreaSpin .8s linear infinite;"></div></div><style>@keyframes nbgAreaSpin{to{transform:rotate(360deg)}}</style>'
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

function componentNames(result) {
  const names = [];
  for (const component of result?.address_components || []) {
    if (component?.long_name) names.push(component.long_name);
    if (component?.short_name) names.push(component.short_name);
  }
  if (result?.formatted_address) names.push(result.formatted_address);
  return names;
}

function resolvePostcodeTown(postcode) {
  if (postcodeTownCache.has(postcode)) return Promise.resolve(postcodeTownCache.get(postcode));

  if (!window.google?.maps?.Geocoder) {
    return Promise.resolve({ resolved: false, covered: false, town: "" });
  }

  return new Promise((resolve) => {
    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode(
      { address: postcode, componentRestrictions: { country: "GB" } },
      (results, status) => {
        if (status !== "OK" || !Array.isArray(results) || !results.length) {
          resolve({ resolved: false, covered: false, town: "" });
          return;
        }

        const names = results.flatMap(componentNames);
        const coveredTown = names.map(findCoveredTown).find(Boolean) || "";
        const locality = results
          .flatMap((result) => result.address_components || [])
          .find((component) =>
            component?.types?.some((type) => type === "postal_town" || type === "locality")
          )?.long_name || "";

        const resolved = {
          resolved: true,
          covered: Boolean(coveredTown),
          town: coveredTown,
          locality,
        };
        postcodeTownCache.set(postcode, resolved);
        resolve(resolved);
      }
    );
  });
}

function finishCovered(root, address, postcode, town, manual) {
  setState(root, "covered", { address, town, postcode, manual });
  clearGuardWarning(root);
  root.dispatchEvent(new CustomEvent("nbg-address-validation-finished", { bubbles: false }));
  return true;
}

function validateAddress(root, forceMessage = false) {
  if (!root) return false;

  const address = String(getAddressInput(root)?.value || "").trim();
  if (!address) {
    setState(root, "idle", { address });
    return false;
  }

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

  if (!postcode.toUpperCase().startsWith("BT")) {
    setState(root, "outside", { address });
    showOutOfArea(root);
    return false;
  }

  const townInText = findCoveredTown(address);
  const uncoveredTownInText = findExplicitUncoveredTown(address);
  const googleFormattedAddress = /,\s*UK\s*$/i.test(address);

  // If the customer has explicitly typed a town that is known to be outside the
  // current service area, reject it immediately. This avoids showing the generic
  // "couldn't verify" message when the postcode geocoder is unavailable.
  if (!townInText && uncoveredTownInText) {
    setState(root, "outside", { address, postcode, town: uncoveredTownInText });
    showOutOfArea(root);
    return false;
  }

  if (googleFormattedAddress) {
    if (!townInText) {
      setState(root, "outside", { address, postcode });
      showOutOfArea(root);
      return false;
    }
    return finishCovered(root, address, postcode, townInText, false);
  }

  if (townInText) {
    return finishCovered(root, address, postcode, townInText, true);
  }

  const cached = postcodeTownCache.get(postcode);
  if (cached?.resolved) {
    if (!cached.covered) {
      setState(root, "outside", { address, postcode, town: cached.locality || "" });
      showOutOfArea(root);
      return false;
    }
    return finishCovered(root, address, postcode, cached.town || "", true);
  }

  const sequence = ++validationSequence;
  setState(root, "checking", { address, postcode });
  showAreaChecking(root);

  resolvePostcodeTown(postcode).then((resolved) => {
    if (sequence !== validationSequence) return;
    const currentAddress = String(getAddressInput(root)?.value || "").trim();
    if (currentAddress !== address) return;

    if (!resolved.resolved) {
      setState(root, "invalid", { address, postcode });
      showAreaUnverified(root);
    } else if (!resolved.covered) {
      setState(root, "outside", { address, postcode, town: resolved.locality || "" });
      showOutOfArea(root);
    } else {
      finishCovered(root, address, postcode, resolved.town || "", true);
    }
    root.dispatchEvent(new CustomEvent("nbg-address-value-changed", { bubbles: false }));
  });

  return false;
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

      const state = validationState.get(root);
      if (state?.status === "covered" || validateAddress(root, true)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      getAddressInput(root)?.focus();
    },
    true
  );

  let lastAddress = String(getAddressInput(root)?.value || "");
  const valueWatcher = window.setInterval(() => {
    if (!document.body.contains(root)) {
      window.clearInterval(valueWatcher);
      return;
    }
    const currentAddress = String(getAddressInput(root)?.value || "");
    if (currentAddress === lastAddress) return;
    lastAddress = currentAddress;
    validateAddress(root, false);
    root.dispatchEvent(new CustomEvent("nbg-address-value-changed", { bubbles: false }));
  }, 200);

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
