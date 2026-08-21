(function () {
  var scheduleTimer = null;
  var lastKey = "";

  function formatDate(value) {
    if (!value) return "";
    var date = new Date(value + "T12:00:00");
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    }).format(date);
  }

  function bookingRoot() {
    var heading = Array.prototype.find.call(document.querySelectorAll("h2"), function (node) {
      return /book a bin clean/i.test(node.textContent || "");
    });
    return heading ? heading.closest(".p-6") : null;
  }

  function readForm(root) {
    if (!root) return null;
    var addressInput = root.querySelector('input[placeholder="Full Address"]');
    if (!addressInput) return null;

    var selects = Array.prototype.slice.call(root.querySelectorAll("select"));
    var bins = [];
    for (var i = 0; i < selects.length; i += 2) {
      var binSelect = selects[i];
      if (!binSelect || !/select bin/i.test(binSelect.options && binSelect.options[0] ? binSelect.options[0].text : "")) continue;
      if (binSelect.value) bins.push({ type: binSelect.value });
    }

    return {
      address: (addressInput.value || "").trim(),
      bins: bins
    };
  }

  function extractPostcode(address) {
    var match = String(address || "").toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i);
    if (!match) return "";
    var compact = match[1].replace(/\s+/g, "");
    return compact.length > 3 ? compact.slice(0, -3) + " " + compact.slice(-3) : compact;
  }

  function ensureCard(root) {
    var existing = root.querySelector("[data-booking-schedule-card]");
    if (existing) return existing;

    var addressInput = root.querySelector('input[placeholder="Full Address"]');
    if (!addressInput) return null;

    var card = document.createElement("div");
    card.setAttribute("data-booking-schedule-card", "true");
    card.style.cssText = "margin-top:12px;padding:14px 16px;border-radius:12px;border:1px solid #d1d5db;background:#f9fafb;font-family:Arial,sans-serif;display:none;";
    addressInput.parentNode.insertBefore(card, addressInput.nextSibling);
    return card;
  }

  function setPrimaryButton(root, automatic) {
    var buttons = Array.prototype.slice.call(root.querySelectorAll("button"));
    var emailButton = buttons.find(function (button) { return /send via email|confirm booking/i.test(button.textContent || ""); });
    if (!emailButton) return;
    emailButton.textContent = automatic ? "Confirm Booking" : "Send via Email";
  }

  function render(root, state, data) {
    var card = ensureCard(root);
    if (!card) return;
    card.style.display = "block";

    if (state === "loading") {
      card.style.background = "#f9fafb";
      card.style.borderColor = "#d1d5db";
      card.innerHTML = '<div style="font-weight:800;color:#111827;">Checking your bin day…</div><div style="margin-top:4px;font-size:13px;color:#6b7280;">We’re matching your council collection date with our cleaning round.</div>';
      setPrimaryButton(root, false);
      return;
    }

    if (state === "automatic") {
      var rows = (data.results || []).map(function (result) {
        var date = formatDate(result.assignedCleanDate);
        return '<div style="margin-top:8px;font-size:14px;color:#14532d;"><strong>' + String(result.bin || "Bin") + ':</strong> ' + date + '</div>';
      }).join("");
      card.style.background = "#f0fdf4";
      card.style.borderColor = "#22c55e";
      card.innerHTML = '<div style="font-weight:900;color:#166534;font-size:16px;">✓ We’ve found your clean day</div>' + rows + '<div style="margin-top:8px;font-size:13px;color:#166534;">Your regular service will continue on the same 4-week cycle.</div>';
      setPrimaryButton(root, true);
      return;
    }

    if (state === "manual") {
      card.style.background = "#fffbeb";
      card.style.borderColor = "#f59e0b";
      card.innerHTML = '<div style="font-weight:900;color:#92400e;">We need to confirm your first clean date</div><div style="margin-top:4px;font-size:13px;color:#92400e;">You can still submit your booking. We’ll confirm the schedule manually rather than risk giving you the wrong date.</div>';
      setPrimaryButton(root, false);
      return;
    }

    card.style.display = "none";
    setPrimaryButton(root, false);
  }

  async function lookup(root) {
    var form = readForm(root);
    if (!form) return;
    var postcode = extractPostcode(form.address);
    if (!form.address || !postcode || !form.bins.length) {
      render(root, "idle");
      return;
    }

    var key = JSON.stringify([form.address, form.bins]);
    if (key === lastKey) return;
    lastKey = key;
    render(root, "loading");

    try {
      var response = await fetch("/api/booking-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: form.address, postcode: postcode, bins: form.bins })
      });
      var data = await response.json();
      var automatic = response.ok && data && data.matched === true && Array.isArray(data.results) && data.results.length > 0 && data.results.every(function (result) {
        return result && result.automatic && result.assignedCleanDate;
      });
      render(root, automatic ? "automatic" : "manual", data);
    } catch (error) {
      render(root, "manual");
    }
  }

  function scheduleLookup(root) {
    clearTimeout(scheduleTimer);
    scheduleTimer = setTimeout(function () { lookup(root); }, 500);
  }

  function bind(root) {
    if (!root || root.dataset.scheduleUiBound === "true") return;
    root.dataset.scheduleUiBound = "true";
    root.addEventListener("input", function () { scheduleLookup(root); });
    root.addEventListener("change", function () { scheduleLookup(root); });
    scheduleLookup(root);
  }

  function scan() {
    var root = bookingRoot();
    if (root) bind(root);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan);
  else scan();

  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
})();
