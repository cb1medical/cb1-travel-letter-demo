/* =============================================================================
 * app.js - CB1 Medical Travel Letter Generator
 * -----------------------------------------------------------------------------
 * Flow:
 *   1. Patient enters PIN -> we try to DECRYPT the signature with it.
 *      Success  = correct PIN -> reveal the form, keep the signature in memory.
 *      Failure  = wrong PIN   -> show error, nothing revealed.
 *   2. As the form changes, we render a live A4 letter preview.
 *   3. "Generate PDF" calls window.print() (print CSS shows only the letter).
 *
 * Privacy: no network, no storage. Everything below lives in memory only and is
 * gone when the tab closes. We never write to localStorage/sessionStorage/cookies.
 * ========================================================================== */

(() => {
  "use strict";

  // In-memory only - never persisted. Map of care-type id -> decrypted data URL.
  let signatures = {};

  // The care type currently selected in the form (defaults to the first).
  function selectedCareType() {
    const sel = $("careType");
    const id = sel && sel.value ? sel.value : (CONFIG.careTypes[0] && CONFIG.careTypes[0].id);
    return CONFIG.careTypes.find(c => c.id === id) || CONFIG.careTypes[0];
  }

  /* --------------------------- small helpers ---------------------------- */

  // Escape user text before inserting into the preview (defensive against
  // any markup in a field showing up as HTML).
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Format an ISO date (yyyy-mm-dd from <input type=date>) as e.g. "21 July 2026".
  function formatDate(iso) {
    if (!iso) return "";
    const parts = iso.split("-");
    if (parts.length !== 3) return esc(iso);
    const [y, m, d] = parts.map(Number);
    const months = ["January","February","March","April","May","June",
                    "July","August","September","October","November","December"];
    if (!y || !m || !d || m < 1 || m > 12) return esc(iso);
    return `${d} ${months[m - 1]} ${y}`;
  }

  // Full years between an ISO date-of-birth (yyyy-mm-dd) and today.
  // Returns null if the date is missing or malformed, -1 if it's in the future.
  function ageFromDob(iso) {
    if (!iso) return null;
    const parts = iso.split("-");
    if (parts.length !== 3) return null;
    const [y, m, d] = parts.map(Number);
    if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const today = new Date();
    const dob = new Date(y, m - 1, d);
    if (dob > today) return -1;
    let age = today.getFullYear() - y;
    const beforeBirthday =
      today.getMonth() < m - 1 ||
      (today.getMonth() === m - 1 && today.getDate() < d);
    if (beforeBirthday) age--;
    return age;
  }

  const MIN_AGE = 18;

  // Every field that must be completed before a letter can be generated.
  // (addr2 is intentionally optional.)
  const REQUIRED_FIELDS = [
    "firstName", "lastName", "dob",
    "addr1", "city", "postcode",
    "jurisdiction", "prescriptionNo",
    "prodBrand", "prodStrength", "prodForm", "prodSize",
    "quantityNum",
    "destinationCountry", "departureDate", "returnDate",
  ];

  // Strength usually looks like T20 or T25:C25 (soft check only, never blocks).
  const STRENGTH_RE = /^T\d{1,4}(:C\d{1,4})?$/i;

  // Build the product name from the guided parts, e.g. "Somai T25:C25 Oil 30ml".
  function buildProduct() {
    const v = id => ($(id) ? $(id).value.trim() : "");
    const size = v("prodSize");
    const unit = v("prodSizeUnit") || "";
    const sizeUnit = size ? (unit === "units" ? `${size} units` : `${size}${unit}`) : "";
    return [v("prodBrand"), v("prodStrength"), v("prodName"), v("prodForm"), sizeUnit]
      .filter(Boolean).join(" ");
  }

  // Validate the whole form. Returns true only when EVERY required field is
  // filled, the patient is 18+, and the travel dates are sane. Updates the
  // inline errors and enables/disables the Download & Print buttons.
  function validateForm() {
    // --- Age check ---
    const iso = ($("dob") && $("dob").value) || "";
    const age = ageFromDob(iso);
    const dobErr = $("dob-error");
    let dobMsg = "";
    if (iso && age === -1) {
      dobMsg = "Date of birth cannot be in the future.";
    } else if (iso && age !== null && age < MIN_AGE) {
      dobMsg = `Patient must be ${MIN_AGE} or over. A travel letter cannot be generated.`;
    }
    if (dobMsg) { dobErr.textContent = dobMsg; dobErr.hidden = false; }
    else { dobErr.hidden = true; }
    const ageOk = age !== null && age >= MIN_AGE;

    // --- Travel date order ---
    const dep = ($("departureDate") && $("departureDate").value) || "";
    const ret = ($("returnDate") && $("returnDate").value) || "";
    const dateErr = $("date-error");
    let dateMsg = "";
    if (dep && ret && ret < dep) {
      dateMsg = "Return date cannot be before the departure date.";
    }
    if (dateMsg) { dateErr.textContent = dateMsg; dateErr.hidden = false; }
    else { dateErr.hidden = true; }
    const datesOk = !dateMsg;

    // --- All required fields present ---
    const allFilled = REQUIRED_FIELDS.every(id => {
      const el = $(id);
      return el && String(el.value).trim() !== "";
    });

    // --- Quantity must be a whole number > 0 ---
    const qtyRaw = ($("quantityNum") && $("quantityNum").value.trim()) || "";
    const qtyNum = Number(qtyRaw);
    const qtyErr = $("quantity-error");
    let qtyMsg = "";
    if (qtyRaw && (!Number.isInteger(qtyNum) || qtyNum < 1)) {
      qtyMsg = "Enter the quantity as a whole number (e.g. 30).";
    }
    if (qtyErr) { qtyErr.textContent = qtyMsg; qtyErr.hidden = !qtyMsg; }
    const qtyOk = !qtyMsg;

    // --- Patient confirmation ticked ---
    const confirmed = !!($("confirm-details") && $("confirm-details").checked);

    const ok = allFilled && ageOk && datesOk && qtyOk && confirmed;

    ["download-btn", "print-btn"].forEach(id => {
      const b = $(id);
      if (b) b.disabled = !ok;
    });
    const note = $("req-note");
    if (note) note.hidden = ok;
    return ok;
  }

  // Today's date, formatted, computed locally (no network).
  function todayFormatted() {
    const now = new Date();
    const months = ["January","February","March","April","May","June",
                    "July","August","September","October","November","December"];
    return `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
  }

  // Add `days` to an ISO date (yyyy-mm-dd) and return it formatted, e.g.
  // addDaysFormatted("2026-07-31", 7) -> "7 August 2026". Empty in -> "".
  function addDaysFormatted(iso, days) {
    if (!iso) return "";
    const parts = iso.split("-").map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return "";
    const dt = new Date(parts[0], parts[1] - 1, parts[2]);
    dt.setDate(dt.getDate() + (days || 0));
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return formatDate(`${y}-${m}-${d}`);
  }

  function $(id) { return document.getElementById(id); }

  /* --------------------------- PIN unlock ------------------------------- */

  async function handleUnlock(e) {
    e.preventDefault();
    const pin = $("pin-input").value;
    const errEl = $("pin-error");
    const busyEl = $("pin-busy");
    const submit = $("pin-submit");

    errEl.hidden = true;
    busyEl.hidden = false;
    submit.disabled = true;

    try {
      if (typeof SIGNATURE_BLOBS === "undefined") {
        throw new Error("signature.enc.js not loaded");
      }
      // The PIN IS the decryption key. Decrypt every consultant's signature;
      // a wrong PIN fails the first one (AES-GCM auth) and we stay locked.
      const decrypted = {};
      for (const [id, blob] of Object.entries(SIGNATURE_BLOBS)) {
        decrypted[id] = await SignatureCrypto.decryptSignature(pin, blob);
      }
      signatures = decrypted;

      // Success: reveal the app.
      $("lock-screen").hidden = true;
      $("app").hidden = false;
      initForm();
      renderPreview();
      fitPreview();
    } catch (err) {
      // Wrong PIN (AES-GCM auth failure) or malformed blob.
      signatures = {};
      errEl.hidden = false;
      $("pin-input").value = "";
      $("pin-input").focus();
    } finally {
      busyEl.hidden = true;
      submit.disabled = false;
    }
  }

  /* --------------------------- form setup ------------------------------- */

  function initForm() {
    // Populate jurisdiction dropdown from config.
    const sel = $("jurisdiction");
    if (sel && sel.options.length === 0) {
      const list = (CONFIG.jurisdictions || []);
      const first = document.createElement("option");
      first.value = ""; first.textContent = "Select…"; first.disabled = true; first.selected = true;
      sel.appendChild(first);
      list.forEach(j => {
        const o = document.createElement("option");
        o.value = j; o.textContent = j;
        sel.appendChild(o);
      });
    }

    // Populate the "type of care" selector (chooses the signing consultant).
    const care = $("careType");
    if (care && care.options.length === 0) {
      (CONFIG.careTypes || []).forEach(c => {
        const o = document.createElement("option");
        o.value = c.id;
        o.textContent = `${c.label} (${c.doctor.name})`;
        care.appendChild(o);
      });
    }

    // Populate the product Form dropdown (generic forms, not a product list).
    const formSel = $("prodForm");
    if (formSel && formSel.options.length === 0) {
      const first = document.createElement("option");
      first.value = ""; first.textContent = "Select…"; first.disabled = true; first.selected = true;
      formSel.appendChild(first);
      ((CONFIG.product && CONFIG.product.forms) || []).forEach(f => {
        const o = document.createElement("option");
        o.value = f; o.textContent = f;
        formSel.appendChild(o);
      });
    }
    if ($("prodStrength") && CONFIG.product && CONFIG.product.strengthHint) {
      $("prodStrength").placeholder = CONFIG.product.strengthHint;
    }

    // Populate the unit dropdowns (pack size + quantity carried) from config.
    const units = (CONFIG.quantity && CONFIG.quantity.units) || ["ml", "g"];
    ["prodSizeUnit", "quantityUnit"].forEach(id => {
      const u = $(id);
      if (u && u.options.length === 0) {
        units.forEach(unit => {
          const o = document.createElement("option");
          o.value = unit; o.textContent = unit;
          u.appendChild(o);
        });
      }
    });

    // Apply brand colours from config (kept in sync with config.js).
    if (CONFIG.brand) {
      const root = document.documentElement.style;
      if (CONFIG.brand.primaryColour) root.setProperty("--brand", CONFIG.brand.primaryColour);
      if (CONFIG.brand.accentColour) root.setProperty("--accent", CONFIG.brand.accentColour);
      if (CONFIG.brand.fontStack) root.setProperty("--font", CONFIG.brand.fontStack);
    }

    // Live preview on any change.
    $("letter-form").addEventListener("input", renderPreview);
    $("download-btn").addEventListener("click", onDownload);
    $("print-btn").addEventListener("click", onPrint);
    $("clear-btn").addEventListener("click", onClear);

    // Over-quantity inline confirmation controls.
    if ($("qty-continue")) $("qty-continue").addEventListener("click", async () => {
      $("qty-confirm").hidden = true;
      await generatePdf();
    });
    if ($("qty-cancel")) $("qty-cancel").addEventListener("click", () => {
      $("qty-confirm").hidden = true;
    });

    // Keep the pinned preview scaled to fit the window.
    window.addEventListener("resize", fitPreview);

    // Start with generation disabled until a valid 18+ DOB is entered.
    $("download-btn").disabled = true;
    $("print-btn").disabled = true;
  }

  // Build a safe, descriptive file name: travel-letter-doe-jane-2026-07-21.pdf
  function buildFileName() {
    const clean = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const last = clean($("lastName") && $("lastName").value);
    const first = clean($("firstName") && $("firstName").value);
    const iso = new Date().toISOString().slice(0, 10);
    const name = ["DEMO-travel-letter", last, first, iso].filter(Boolean).join("-");
    return `${name}.pdf`;
  }

  function setStatus(msg) {
    const el = $("pdf-status");
    if (el) el.innerHTML = msg;
  }

  function readFields() {
    const v = id => ($(id) ? $(id).value.trim() : "");
    const first = v("firstName"), last = v("lastName");
    const addressLines = [v("addr1"), v("addr2"), v("city"), v("postcode")].filter(Boolean);
    return {
      patientName: [first, last].filter(Boolean).join(" "),
      patientDob: formatDate(v("dob")),
      patientAddress: addressLines.join(", "),
      addressLines,
      jurisdiction: v("jurisdiction"),
      prescriptionNo: v("prescriptionNo"),
      medication: buildProduct(),
      quantity: v("quantityNum") ? `${v("quantityNum")} ${v("quantityUnit")}` : "",
      destination: (function () {
        const country = v("destinationCountry");
        const city = v("destinationCity");
        return city ? `${country} (${city})` : country;
      })(),
      departureDate: formatDate(v("departureDate")),
      returnDate: formatDate(v("returnDate")),
      issueDate: todayFormatted(),
      clinicName: CONFIG.clinic.name,
      doctorName: selectedCareType().doctor.name,
    };
  }

  // Friendly placeholders shown in the live preview while a field is still empty,
  // so the patient can see what belongs where.
  const PLACEHOLDERS = {
    patientName: "[patient name]",
    patientDob: "[date of birth]",
    patientAddress: "[home address]",
    jurisdiction: "[where issued]",
    destination: "[destination]",
    departureDate: "[departure date]",
    returnDate: "[return date]",
    prescriptionNo: "[prescription number]",
    medication: "[product]",
    quantity: "[quantity]",
  };

  // Replace {{placeholders}} in a template string, HTML-escaping each value.
  // Empty values fall back to a readable placeholder so blanks never appear.
  function interpolate(template, data) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const val = data[key];
      if (val == null || val === "") return esc(PLACEHOLDERS[key] || `[${key}]`);
      return esc(val);
    });
  }

  /* --------------------------- render preview --------------------------- */

  function renderPreview() {
    validateForm();
    const d = readFields();
    const L = CONFIG.letter;

    // Letterhead
    const clinicLines = [
      `<span class="clinic-name">${esc(CONFIG.clinic.name)}</span>`,
      ...(CONFIG.clinic.addressLines || []).map(esc),
      CONFIG.clinic.phone ? `Tel: ${esc(CONFIG.clinic.phone)}` : "",
      CONFIG.clinic.email ? esc(CONFIG.clinic.email) : "",
      CONFIG.clinic.website ? esc(CONFIG.clinic.website) : "",
      CONFIG.clinic.registration ? esc(CONFIG.clinic.registration) : "",
    ].filter(Boolean);
    $("letter-clinic").innerHTML = clinicLines.join("<br>");

    // Date
    $("issue-date").textContent = d.issueDate;

    // Recipient block (patient) - address shown one part per line.
    $("rcpt-name").textContent = d.patientName || "[Patient name]";
    $("rcpt-address").innerHTML = d.addressLines.length
      ? d.addressLines.map(esc).join("<br>")
      : "[Patient address]";

    // Salutation + subject
    $("salutation").textContent = L.salutation;
    if ($("subject")) $("subject").textContent = interpolate(L.subject || "", d);

    // Body paragraphs. A paragraph ending in "||MED" renders as an emphasised
    // medication block.
    const bodyHtml = (L.bodyParagraphs || [])
      .map(p => {
        if (p.endsWith("||MED")) {
          return `<p class="letter-med">${interpolate(p.slice(0, -5), d)}</p>`;
        }
        return `<p>${interpolate(p, d)}</p>`;
      })
      .join("");
    $("letter-body").innerHTML = bodyHtml;

    // "Note for patient" section (traveller responsibilities + disclaimer).
    const N = L.patientNotes;
    if (N && $("letter-notes")) {
      // Page 2 annex: title + a line tying this information to the patient's letter.
      if ($("annex-title")) $("annex-title").textContent = N.heading || "Important information";
      if ($("annex-for")) {
        $("annex-for").innerHTML =
          `This information accompanies the travel letter for ` +
          `<strong>${esc(d.patientName || "the patient")}</strong>` +
          (d.issueDate ? ` dated ${esc(d.issueDate)}` : "") + `.`;
      }
      const steps = (N.steps || []).map(s => `<li>${interpolate(s, d)}</li>`).join("");
      // Disclaimer: combine any parts into ONE paragraph, with a bold lead-in label.
      let discHtml = "";
      if (N.disclaimer) {
        const parts = Array.isArray(N.disclaimer) ? N.disclaimer : [N.disclaimer];
        const text = parts.map(x => interpolate(x, d)).join(" ");
        const lead = N.disclaimerHeading ? `<strong>${esc(N.disclaimerHeading)}.</strong> ` : "";
        discHtml = `<p class="notes-disclaimer">${lead}${text}</p>`;
      }
      $("letter-notes").innerHTML =
        (N.intro ? `<p class="notes-intro">${interpolate(N.intro, d)}</p>` : "") +
        (steps ? `<ol class="notes-steps">${steps}</ol>` : "") +
        discHtml;
    }

    // Validity box: issue date, travel window, and an auto-calculated expiry
    // (return date + configurable buffer) so officials can see validity at a glance.
    const retIso = ($("returnDate") && $("returnDate").value) || "";
    const bufferDays = (CONFIG.letter && CONFIG.letter.expiryBufferDays) || 0;
    const expiryStr = addDaysFormatted(retIso, bufferDays);
    const validityBits = [
      `<p><strong>Issue date:</strong> ${esc(d.issueDate)}</p>`,
      `<p><strong>Travel start:</strong> ${esc(d.departureDate || "[departure]")}</p>`,
      `<p><strong>Travel end:</strong> ${esc(d.returnDate || "[return]")}</p>`,
      `<p><strong>Letter expires:</strong> ${esc(expiryStr || "[expiry]")}</p>`,
      `<p>This letter is valid for the travel period above and expires on the date shown.</p>`,
    ];
    $("letter-validity").innerHTML = validityBits.join("");

    // Closing + signature block
    $("closing").textContent = L.closing;
    const care = selectedCareType();
    const sig = signatures[care.id];
    if (sig) $("signature-img").src = sig;
    $("sign-name").textContent = care.doctor.name;
    $("sign-title").textContent = care.doctor.title;
    $("sign-gmc").textContent = care.doctor.gmc ? `GMC: ${care.doctor.gmc}` : "";

    updateFormHints(d);
  }

  // Soft, non-blocking guidance shown beside the form fields.
  function updateFormHints(d) {
    // Live preview of the assembled product name.
    if ($("product-preview")) $("product-preview").textContent = d.medication || "-";

    // Strength format nudge (never blocks).
    const sEl = $("prodStrength"), sHint = $("strength-hint");
    if (sEl && sHint) {
      const sv = sEl.value.trim();
      if (sv && !STRENGTH_RE.test(sv)) {
        sHint.textContent = "Strength usually looks like T20 or T25:C25. You can still continue.";
        sHint.hidden = false;
      } else { sHint.hidden = true; }
    }

    // Quantity soft warning; also clears any stale over-quantity prompt.
    const qEl = $("quantityNum"), uEl = $("quantityUnit"), qWarn = $("quantity-warn");
    if (qWarn) {
      if (quantityOverThreshold()) {
        qWarn.textContent = "This quantity is unusually large. Please double-check it is correct.";
        qWarn.hidden = false;
      } else {
        qWarn.hidden = true;
        if ($("qty-confirm")) $("qty-confirm").hidden = true;
      }
    }
  }

  // True when the entered quantity exceeds the configured per-unit threshold.
  function quantityOverThreshold() {
    const n = parseInt(($("quantityNum") && $("quantityNum").value) || "", 10);
    const unit = ($("quantityUnit") && $("quantityUnit").value) || "";
    const t = CONFIG.quantity && CONFIG.quantity.warnAbove ? CONFIG.quantity.warnAbove[unit] : undefined;
    return Number.isFinite(n) && t != null && n > t;
  }

  // Scale the on-screen letter so page 1 fits the viewport height, keeping the
  // pinned preview fully visible while filling the form. Uses CSS `zoom`, which
  // is reset to full size during PDF capture, so the download is unaffected.
  function fitPreview() {
    const letter = $("letter");
    const page1 = $("letter-page-1");
    if (!letter || !page1) return;
    letter.style.zoom = "1";                       // measure natural height
    const avail = window.innerHeight - 40;         // sticky offset + margins
    const h = page1.offsetHeight || 1;
    const z = Math.max(0.55, Math.min(1, avail / h));
    letter.style.zoom = String(z);
  }

  /* ------------------------------ actions ------------------------------- */

  // One-click: render the letter to an A4 PDF and download it instantly.
  // Uses locally-bundled jsPDF + html2canvas - no network access.
  //
  // Each ".letter-page" is captured on its OWN A4 page, so page 1 (the signed
  // letter) and page 2 (the information annex) stay cleanly separated - no
  // spill-over. If a single sheet somehow exceeds one page it is scaled down
  // uniformly to fit, never split.
  async function onDownload() {
    renderPreview();
    if (!validateForm()) { setStatus("Please complete all fields first."); return; }

    // Unusually large quantity: ask for an explicit confirmation (inline, no
    // native dialog) before generating. Continue is wired in initForm.
    if (quantityOverThreshold()) {
      if ($("qty-confirm")) $("qty-confirm").hidden = false;
      setStatus("Please confirm the quantity before downloading.");
      return;
    }
    await generatePdf();
  }

  async function generatePdf() {
    const btn = $("download-btn");
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Generating…";
    setStatus("Generating your PDF…");

    const pages = Array.from(document.querySelectorAll("#letter .letter-page"));
    const restore = [];
    // Capture at full size: the on-screen preview zoom must not affect the PDF.
    const letterEl = $("letter");
    const prevZoom = letterEl ? letterEl.style.zoom : "";
    if (letterEl) letterEl.style.zoom = "1";
    try {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
      const pageWmm = 210, pageHmm = 297;

      for (let i = 0; i < pages.length; i++) {
        const el = pages[i];
        // Capture at true content height (not the A4 min-height) so a short
        // annex page has a clean white tail rather than a stretched image.
        restore.push([el, el.style.minHeight]);
        el.style.minHeight = "auto";

        const canvas = await html2canvas(el, {
          scale: 2,
          backgroundColor: "#ffffff",
          useCORS: false,          // everything is same-origin / data: already
          logging: false,
        });

        const pxPerMm = el.offsetWidth / pageWmm;    // css px that map to 210mm
        const naturalHmm = el.offsetHeight / pxPerMm;
        let drawWmm = pageWmm, drawHmm = naturalHmm;
        if (naturalHmm > pageHmm) {                  // never exceed one sheet
          const fit = pageHmm / naturalHmm;
          drawWmm = pageWmm * fit;
          drawHmm = pageHmm;
        }
        const offX = (pageWmm - drawWmm) / 2;        // centre horizontally if shrunk
        if (i > 0) pdf.addPage();
        pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", offX, 0, drawWmm, drawHmm);
      }

      pdf.save(buildFileName());
      setStatus("✓ PDF downloaded. Nothing was uploaded.");
    } catch (err) {
      setStatus("Sorry - could not generate the PDF. Please try “Print” instead.");
    } finally {
      restore.forEach(([el, v]) => { el.style.minHeight = v; });
      if (letterEl) letterEl.style.zoom = prevZoom;
      btn.textContent = original;
      validateForm(); // restore correct enabled/disabled state
    }
  }

  function onPrint() {
    renderPreview();
    // Hard gate: never generate a letter until the whole form is valid.
    if (!validateForm()) { setStatus("Please complete all fields first."); return; }
    window.print();
  }

  function onClear() {
    $("letter-form").reset();
    // Re-select the disabled placeholder in the dropdowns.
    ["jurisdiction", "prodForm"].forEach(id => { const s = $(id); if (s) s.selectedIndex = 0; });
    if ($("qty-confirm")) $("qty-confirm").hidden = true;
    renderPreview();
  }

  /* ------------------------------ wire up ------------------------------- */

  document.addEventListener("DOMContentLoaded", () => {
    // Mirror the lock-screen logo brand colour early (before unlock).
    if (typeof CONFIG !== "undefined" && CONFIG.brand) {
      const root = document.documentElement.style;
      if (CONFIG.brand.primaryColour) root.setProperty("--brand", CONFIG.brand.primaryColour);
      if (CONFIG.brand.accentColour) root.setProperty("--accent", CONFIG.brand.accentColour);
    }
    $("pin-form").addEventListener("submit", handleUnlock);
    $("pin-input").focus();
  });
})();
