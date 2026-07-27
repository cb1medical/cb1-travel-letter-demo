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
    "jurisdiction", "prescriptionNo", "medication", "dose", "quantity",
    "destination", "departureDate", "returnDate",
  ];

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

    const ok = allFilled && ageOk && datesOk;

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
      medication: v("medication"),
      dose: v("dose"),
      quantity: v("quantity"),
      destination: v("destination"),
      departureDate: formatDate(v("departureDate")),
      returnDate: formatDate(v("returnDate")),
      issueDate: todayFormatted(),
      clinicName: CONFIG.clinic.name,
      doctorName: selectedCareType().doctor.name,
    };
  }

  // Replace {{placeholders}} in a template string, HTML-escaping each value.
  function interpolate(template, data) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
      esc(data[key] != null ? data[key] : `[${key}]`)
    );
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
      const steps = (N.steps || []).map(s => `<li>${interpolate(s, d)}</li>`).join("");
      $("letter-notes").innerHTML =
        `<h4 class="notes-heading">${esc(N.heading || "")}</h4>` +
        (N.intro ? `<p>${interpolate(N.intro, d)}</p>` : "") +
        (steps ? `<ol class="notes-steps">${steps}</ol>` : "") +
        (N.disclaimer ? (Array.isArray(N.disclaimer) ? N.disclaimer : [N.disclaimer]).map(x => `<p class="notes-disclaimer">${interpolate(x, d)}</p>`).join("") : "");
    }

    // Validity box: issue date + travel validity window.
    const validityBits = [];
    validityBits.push(`<p><strong>Issued:</strong> ${esc(d.issueDate)}</p>`);
    if (d.departureDate || d.returnDate) {
      validityBits.push(
        `<p><strong>Intended travel:</strong> ${esc(d.departureDate || "[departure]")} ` +
        `to ${esc(d.returnDate || "[return]")}. This letter relates to that travel period only.</p>`
      );
    }
    $("letter-validity").innerHTML = validityBits.join("");

    // Closing + signature block
    $("closing").textContent = L.closing;
    const care = selectedCareType();
    const sig = signatures[care.id];
    if (sig) $("signature-img").src = sig;
    $("sign-name").textContent = care.doctor.name;
    $("sign-title").textContent = care.doctor.title;
    $("sign-gmc").textContent = care.doctor.gmc ? `GMC: ${care.doctor.gmc}` : "";
  }

  /* ------------------------------ actions ------------------------------- */

  // One-click: render the letter to an A4 PDF and download it instantly.
  // Uses locally-bundled jsPDF + html2canvas - no network access.
  async function onDownload() {
    renderPreview();
    if (!validateForm()) { setStatus("Please complete all fields first."); return; }

    const btn = $("download-btn");
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Generating…";
    setStatus("Generating your PDF…");

    const letter = $("letter");
    const prevMinHeight = letter.style.minHeight;
    try {
      // Capture at the letter's true content height (not the A4 min-height),
      // so a short letter is exactly one page with no blank tail.
      letter.style.minHeight = "auto";

      const scale = 2;
      const canvas = await html2canvas(letter, {
        scale,
        backgroundColor: "#ffffff",
        useCORS: false,         // everything is same-origin / data: already
        logging: false,
      });

      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
      const pageWmm = 210, pageHmm = 297;

      const letterCssW = letter.offsetWidth;         // px that map to 210mm
      const letterCssH = letter.offsetHeight;        // true content height (px)
      const pxPerMm = letterCssW / pageWmm;
      // Always produce a SINGLE page. A travel letter belongs on one page, so
      // if the content is taller than one A4 page we scale the whole letter
      // down uniformly (aspect ratio preserved) rather than letting the tail,
      // e.g. the signature block, spill onto a near-empty second page.
      const naturalHmm = letterCssH / pxPerMm;      // height at full 210mm width
      let drawWmm = pageWmm;
      let drawHmm = naturalHmm;
      if (naturalHmm > pageHmm) {
        const fit = pageHmm / naturalHmm;
        drawWmm = pageWmm * fit;
        drawHmm = pageHmm;
      }
      const offX = (pageWmm - drawWmm) / 2;         // centre horizontally when shrunk
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", offX, 0, drawWmm, drawHmm);

      pdf.save(buildFileName());
      setStatus("✓ PDF downloaded. Nothing was uploaded.");
    } catch (err) {
      setStatus("Sorry - could not generate the PDF. Please try “Print” instead.");
    } finally {
      letter.style.minHeight = prevMinHeight;
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
    // Re-select the disabled placeholder in the dropdown.
    const sel = $("jurisdiction");
    if (sel) sel.selectedIndex = 0;
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
