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

function findBinSelects(root) {
  return Array.from(root?.querySelectorAll("select") || []).filter((select) => {
    const first = select.options?.[0]?.textContent || "";
    return /select bin/i.test(first);
  });
}

function topLevelChild(container, node) {
  if (!container || !node || !container.contains(node)) return null;
  let current = node;
  while (current?.parentElement && current.parentElement !== container) {
    current = current.parentElement;
  }
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

  const nameInput = root?.querySelector('input[placeholder="Your Name"]');
  const addressInput = root?.querySelector('input[placeholder="Full Address"]');
  const firstBinSelect = findBinSelects(root)[0];
  const discountInput = root?.querySelector('input[placeholder="Enter code"]');

  if (!addressInput || !firstBinSelect || !discountInput) return;

  const container = findSharedContainer(root, [nameInput, addressInput, firstBinSelect, discountInput]);
  const addressBlock = topLevelChild(container, addressInput);
  const binBlock = topLevelChild(container, firstBinSelect);

  if (addressBlock && binBlock && addressBlock !== binBlock && addressBlock.nextElementSibling !== binBlock) {
    container.insertBefore(addressBlock, binBlock);
  }

  const tipNode = findTipNode(root);
  const tipBlock = topLevelChild(container, tipNode);
  if (addressBlock && tipBlock && tipBlock !== addressBlock) {
    const desiredBefore = addressBlock.nextSibling;
    if (tipBlock !== desiredBefore) container.insertBefore(tipBlock, desiredBefore);
  }

  root.dataset.bookingLayoutOrdered = "true";
}

function getFormData(root) {
  const addressInput = root?.querySelector('input[placeholder="Full Address"]');
  if (!addressInput) return null;

  const bins = findBinSelects(root)
    .filter((select) => select.value)
    .map((select) => ({ type: select.value }));
  const address = String(addressInput.value || "").trim();

  return {
    address,
    postcode: extractPostcode(address),
    bins,
  };
}

function positionPanel(root, panel) {
  const addressInput = root?.querySelector('input[placeholder="Full Address"]');
  const firstBinSelect = findBinSelects(root)[0];
  const discountInput = root?.querySelector('input[placeholder="Enter code"]');
  if (!addressInput || !firstBinSelect || !discountInput || !panel) return;

  const container = findSharedContainer(root, [addressInput, firstBinSelect, discountInput]);
  const discountBlock = topLevelChild(container, discountInput);
  if (!discountBlock) return;

  if (panel.parentElement !== container || panel.nextSibling !== discountBlock) {
    container.insertBefore(panel, discountBlock);
  }
}

function ensurePanel(root) {
  reorderBookingLayout(root);

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

function setEmailButton(root, automatic) {
  const button = Array.from(root.querySelectorAll("button")).find((node) => /send via email|confirm booking/i.test(node.textContent || ""));
  if (button) button.textContent = automatic ? "Confirm Booking" : "Send via Email";
}

function render(root, state, data = null) {
  const panel = ensurePanel(root);
  if (!panel) return;

  panel.className = "mt-3 rounded-xl border px-4 py-3 text-sm";

  if (state === "idle") {
    panel.classList.add("border-green-300", "bg-green-50", "text-green-900");
    panel.innerHTML = '<div class="font-bold">Automatic clean-date booking</div><div class="mt-1 text-xs leading-5">Select your bin and enter your full address. We’ll check the council collection day and match it to our next cleaning round.</div>';
    setEmailButton(root, false);
    return;
  }

  if (state === "loading") {
    panel.classList.add("border-gray-300", "bg-gray-50", "text-gray-800");
    panel.innerHTML = '<div class="font-bold">Checking your bin day…</div><div class="mt-1 text-xs text-gray-600">Matching the council calendar with our 4-week cleaning round.</div>';
    setEmailButton(root, false);
    return;
  }

  if (state === "matched") {
    const rows = (data?.results || []).map((result) => `<div class="mt-1"><strong>${result.bin || "Bin"}:</strong> ${formatDate(result.assignedCleanDate)}</div>`).join("");
    panel.classList.add("border-green-500", "bg-green-50", "text-green-900");
    panel.innerHTML = `<div class="font-bold">✓ We’ve found your clean day</div>${rows}<div class="mt-2 text-xs">Your regular service will continue on the same 4-week cycle.</div>`;
    setEmailButton(root, true);
    return;
  }

  panel.classList.add("border-amber-400", "bg-amber-50", "text-amber-900");
  panel.innerHTML = '<div class="font-bold">We need to confirm your first clean date</div><div class="mt-1 text-xs leading-5">You can still submit your booking. We’ll confirm the date manually rather than risk giving you the wrong one.</div>';
  setEmailButton(root, false);
}

async function runLookup(root) {
  const form = getFormData(root);
  if (!form || !form.address || !form.postcode || !form.bins.length) {
    render(root, "idle");
    return;
  }

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
    const matched = response.ok && data?.matched === true && Array.isArray(data.results) && data.results.length > 0 && data.results.every((result) => result?.automatic && result?.assignedCleanDate);
    render(root, matched ? "matched" : "manual", data);
  } catch (error) {
    if (error?.name !== "AbortError") render(root, "manual");
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
  render(root, "idle");
  root.addEventListener("input", () => scheduleLookup(root));
  root.addEventListener("change", () => scheduleLookup(root));
}

function bindAfterOpen() {
  let attempts = 0;
  const tryBind = () => {
    attempts += 1;
    const root = findBookingRoot();
    if (root) {
      bindBookingRoot(root);
      return;
    }
    if (attempts < 12) window.setTimeout(tryBind, 50);
  };
  window.setTimeout(tryBind, 0);
}

document.addEventListener("click", (event) => {
  const target = event.target?.closest?.("button, a");
  if (!target) return;
  const text = String(target.textContent || "").trim();
  if (/book a clean|book a bin clean/i.test(text) || target.dataset?.openBookingForm === "true") {
    bindAfterOpen();
  }
}, true);
