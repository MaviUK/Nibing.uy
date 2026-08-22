const DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

let lookupTimer = null;
let activeController = null;

function formatDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : DATE_FORMATTER.format(date);
}

function extractPostcode(address) {
  const match = String(address || "").toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i);
  if (!match) return "";
  const compact = match[1].replace(/\s+/g, "");
  return compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
}

function findBookingRoot() {
  const headings = Array.from(document.querySelectorAll("h2"));
  const heading = headings.find((node) => /book a bin clean/i.test(node.textContent || ""));
  if (!heading) return null;
  return heading.closest(".p-6") || heading.parentElement;
}

function serviceAreaBlocksLookup(root) {
  const status = String(root?.dataset?.addressValidation || "");
  return status === "outside" || status === "invalid";
}

function findBinSelects(root) {
  return Array.from(root?.querySelectorAll("select") || []).filter((select) => {
    const first = select.options?.[0]?.textContent || "";
    return /select bin/i.test(first);
  });
}

function findFrequencySelect(root) {
  return Array.from(root?.querySelectorAll("select") || []).find((select) => {
    const text = Array.from(select.options || []).map((option) => option.textContent || "").join(" ");
    return /one[- ]?off/i.test(text) && /4\s*weekly/i.test(text);
  }) || null;
}

function isOneOffBooking(root) {
  const select = findFrequencySelect(root);
  if (!select) return false;
  const selectedText = select.options?.[select.selectedIndex]?.textContent || select.value || "";
  return /one[- ]?off/i.test(selectedText);
}

function topLevelChild(container, node) {
  if (!container || !node || !container.contains(node)) return null;
  let current = node;
  while (current?.parentElement && current.parentElement !== container) current = current.parentElement;
  return current?.parentElement === container ? current : null;
}

function findSharedContainer(root, nodes) {
  const valid = nodes.filter(Boolean);
  if (!valid.length) return root;
  let container = valid[0].parentElement;
  while (container && container !== root) {
    if (valid.every((node) => container.contains(node))) return container;
    container = container.parentElement;
  }
  return root;
}

function findTipNode(root) {
  return Array.from(root.querySelectorAll("p, div, span")).find((node) => {
    const text = String(node.textContent || "").trim();
    return /^tip:\s*pick from suggestions/i.test(text) && !Array.from(node.children || []).some((child) => /^tip:\s*pick from suggestions/i.test(String(child.textContent || "").trim()));
  });
}

function reorderBookingLayout(root) {
  if (!root || root.dataset.bookingLayoutOrdered === "true") return;
  const nameInput = root.querySelector('input[placeholder="Your Name"]');
  const addressInput = root.querySelector('input[placeholder="Full Address"]');
  const firstBinSelect = findBinSelects(root)[0];
  const discountInput = root.querySelector('input[placeholder="Enter code"]');
  if (!addressInput || !firstBinSelect || !discountInput) return;

  const container = findSharedContainer(root, [nameInput, addressInput, firstBinSelect, discountInput]);
  const addressBlock = topLevelChild(container, addressInput);
  const binBlock = topLevelChild(container, firstBinSelect);
  if (addressBlock && binBlock && addressBlock !== binBlock && addressBlock.nextElementSibling !== binBlock) container.insertBefore(addressBlock, binBlock);

  const tipNode = findTipNode(root);
  const tipBlock = topLevelChild(container, tipNode);
  if (addressBlock && tipBlock && tipBlock !== addressBlock) {
    const desiredBefore = addressBlock.nextSibling;
    if (tipBlock !== desiredBefore) container.insertBefore(tipBlock, desiredBefore);
  }
  root.dataset.bookingLayoutOrdered = "true";
}

function ensurePostcodeMessage(root) {
  let message = root.querySelector("[data-postcode-validation]");
  if (message) return message;
  const addressInput = root.querySelector('input[placeholder="Full Address"]');
  if (!addressInput) return null;
  message = document.createElement("div");
  message.dataset.postcodeValidation = "true";
  message.className = "mt-2 text-xs font-semibold text-red-600";
  message.style.display = "none";
  message.textContent = "Please include your postcode in the address.";
  addressInput.insertAdjacentElement("afterend", message);
  return message;
}

function validatePostcode(root, forceMessage = false) {
  const addressInput = root?.querySelector('input[placeholder="Full Address"]');
  if (!addressInput) return false;
  const address = String(addressInput.value || "").trim();
  const valid = Boolean(extractPostcode(address));
  const message = ensurePostcodeMessage(root);
  if (message) message.style.display = !valid && (forceMessage || address.length > 5) ? "block" : "none";
  addressInput.setCustomValidity(valid || !address ? "" : "Please include your postcode in the address.");
  return valid;
}

function getFormData(root) {
  const addressInput = root?.querySelector('input[placeholder="Full Address"]');
  if (!addressInput) return null;
  const bins = findBinSelects(root).filter((select) => select.value).map((select) => ({ type: select.value }));
  const address = String(addressInput.value || "").trim();
  return { address, postcode: extractPostcode(address), bins };
}

function positionPanel(root, panel) {
  const addressInput = root?.querySelector('input[placeholder="Full Address"]');
  const firstBinSelect = findBinSelects(root)[0];
  const discountInput = root?.querySelector('input[placeholder="Enter code"]');
  if (!addressInput || !firstBinSelect || !discountInput || !panel) return;
  const container = findSharedContainer(root, [addressInput, firstBinSelect, discountInput]);
  const discountBlock = topLevelChild(container, discountInput);
  if (discountBlock && (panel.parentElement !== container || panel.nextSibling !== discountBlock)) container.insertBefore(panel, discountBlock);
}

function ensurePanel(root) {
  reorderBookingLayout(root);
  ensurePostcodeMessage(root);
  let panel = root.querySelector("[data-auto-schedule-panel]");
  if (!panel) {
    panel = document.createElement("div");
    panel.dataset.autoSchedulePanel = "true";
    panel.className = "mt-3 rounded-xl border px-4 py-3 text-sm";
    root.appendChild(panel);
  }
  positionPanel(root, panel);
  return panel;
}

function keepSubmitButtonLabels(root) {
  const buttons = Array.from(root.querySelectorAll("button"));
  const whatsapp = buttons.find((node) => /send via whatsapp/i.test(String(node.textContent || "")));
  const email = buttons.find((node) => /send via email|confirm booking|sending booking/i.test(String(node.textContent || "")));
  if (whatsapp && whatsapp.textContent !== "Send Via WhatsApp") whatsapp.textContent = "Send Via WhatsApp";
  if (email && email.textContent !== "Send Via Email") email.textContent = "Send Via Email";
}

function render(root, state, data = null) {
  if (serviceAreaBlocksLookup(root)) return;
  const panel = ensurePanel(root);
  if (!panel) return;
  keepSubmitButtonLabels(root);
  panel.className = "mt-3 rounded-xl border px-4 py-3 text-sm";
  if (state === "idle") {
    panel.classList.add("border-green-300", "bg-green-50", "text-green-900");
    panel.innerHTML = '<div class="font-bold">Next Clean Date</div><div class="mt-1 text-xs leading-5">Please fill in the above to show date.</div>';
    return;
  }
  if (state === "loading") {
    panel.classList.add("border-gray-300", "bg-gray-50", "text-gray-800");
    panel.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;min-height:74px;"><div aria-label="Checking bin days and availability" role="status" style="width:34px;height:34px;border:4px solid #d1d5db;border-top-color:#16a34a;border-radius:9999px;animation:nbgScheduleSpin .8s linear infinite;"></div></div><style>@keyframes nbgScheduleSpin{to{transform:rotate(360deg)}}</style>';
    return;
  }
  if (state === "matched") {
    const rows = (data?.results || []).map((result) => `<div class="mt-1"><strong>${result.bin || "Bin"}:</strong> ${formatDate(result.assignedCleanDate)}</div>`).join("");
    const cycleNote = isOneOffBooking(root) ? "" : '<div class="mt-2 text-xs">Your regular service will continue on the same 4-week cycle.</div>';
    panel.classList.add("border-green-500", "bg-green-50", "text-green-900");
    panel.innerHTML = `<div class="font-bold">✓ We’ve found your clean day</div>${rows}${cycleNote}`;
    return;
  }
  panel.classList.add("border-amber-400", "bg-amber-50", "text-amber-900");
  panel.innerHTML = '<div class="font-bold">We need to confirm your first clean date</div><div class="mt-1 text-xs leading-5">You can still submit your booking. We’ll confirm the date manually rather than risk giving you the wrong one.</div>';
}

async function runLookup(root) {
  if (serviceAreaBlocksLookup(root)) {
    if (activeController) activeController.abort();
    return;
  }

  const form = getFormData(root);
  if (!form || !form.address || !form.bins.length) {
    validatePostcode(root, false);
    render(root, "idle");
    return;
  }
  if (!form.postcode) {
    validatePostcode(root, true);
    render(root, "idle");
    return;
  }
  validatePostcode(root, false);
  if (activeController) activeController.abort();
  activeController = new AbortController();
  render(root, "loading");
  try {
    const response = await fetch("/api/booking-schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
      signal: activeController.signal,
    });
    const data = await response.json();
    if (serviceAreaBlocksLookup(root)) return;
    const matched = response.ok && data?.matched === true && Array.isArray(data.results) && data.results.length > 0 && data.results.every((result) => result?.automatic && result?.assignedCleanDate);
    render(root, matched ? "matched" : "manual", data);
  } catch (error) {
    if (error?.name !== "AbortError" && !serviceAreaBlocksLookup(root)) render(root, "manual");
  }
}

function scheduleLookup(root) {
  window.clearTimeout(lookupTimer);
  lookupTimer = window.setTimeout(() => runLookup(root), 450);
}

function bindBookingRoot(root) {
  if (!root || root.dataset.autoScheduleBound === "true") return;
  root.dataset.autoScheduleBound = "true";
  reorderBookingLayout(root);
  ensurePostcodeMessage(root);
  render(root, "idle");
  keepSubmitButtonLabels(root);
  const labelObserver = new MutationObserver(() => keepSubmitButtonLabels(root));
  labelObserver.observe(root, { childList: true, subtree: true, characterData: true });
  root.addEventListener("input", () => scheduleLookup(root));
  root.addEventListener("change", () => scheduleLookup(root));
  root.addEventListener("nbg-address-value-changed", () => scheduleLookup(root));
  root.addEventListener("click", (event) => {
    const button = event.target?.closest?.("button");
    if (!button || !/send via whatsapp|send via email|confirm booking/i.test(String(button.textContent || ""))) return;
    if (serviceAreaBlocksLookup(root) || !validatePostcode(root, true)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      const addressInput = root.querySelector('input[placeholder="Full Address"]');
      addressInput?.focus();
      if (!serviceAreaBlocksLookup(root)) addressInput?.reportValidity?.();
    }
  }, true);
}

function bindAfterOpen() {
  let attempts = 0;
  const tryBind = () => {
    attempts += 1;
    const root = findBookingRoot();
    if (root) { bindBookingRoot(root); return; }
    if (attempts < 12) window.setTimeout(tryBind, 50);
  };
  window.setTimeout(tryBind, 0);
}

document.addEventListener("click", (event) => {
  const target = event.target?.closest?.("button, a");
  if (!target) return;
  const text = String(target.textContent || "").trim();
  if (/book a clean|book a bin clean/i.test(text) || target.dataset?.openBookingForm === "true") bindAfterOpen();
}, true);
