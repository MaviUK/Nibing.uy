/* Owner-only Customer HQ upload preflight. Never reads or transmits file bytes.
   Prevent oversized Squeegee .sqg archives reaching Netlify as HTTP 413. */
(function () {
  "use strict";
  var MAX_JSON_BYTES = 3000000;
  function message(file) {
    if (!file) return "Select your prepared Customer HQ JSON file first.";
    if (!/\.json$/i.test(file.name || "")) {
      return "This is not a Customer HQ JSON file. A Squeegee .sqg backup is the full archive and cannot be uploaded here. Please choose the prepared NI_Bin_Guy_Customer_HQ_Secure_Import_PRIVATE_2026-11-05_PER_BIN.json file instead.";
    }
    if (file.size > MAX_JSON_BYTES) {
      return "This file is too large for the secure Customer HQ importer. The prepared JSON must be under 3 MB. Do not upload the full Squeegee backup.";
    }
    if (file.size < 100) return "This JSON file is empty or incomplete. No data was uploaded.";
    return "";
  }
  function attach() {
    var form = document.getElementById("hq-history-upload-form");
    var field = document.getElementById("hq-history-file");
    var alert = document.getElementById("hq-upload-error");
    if (!form || !field || !alert) return;
    function check() {
      var file = field.files && field.files[0];
      var error = file ? message(file) : "";
      alert.textContent = error;
      return !error;
    }
    field.addEventListener("change", check);
    form.addEventListener("submit", function (event) {
      if (check()) return;
      event.preventDefault();
      alert.setAttribute("tabindex", "-1");
      alert.focus();
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach, { once: true });
  } else {
    attach();
  }
})();
