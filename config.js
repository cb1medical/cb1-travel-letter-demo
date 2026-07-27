/* =============================================================================
 * config.js - CB1 Medical Travel Letter Generator
 * -----------------------------------------------------------------------------
 * THIS IS THE ONLY FILE CB1 STAFF NEED TO EDIT (plus swapping the logo/signature).
 *
 * Everything CB1-specific lives here: clinic details, doctor details, brand
 * colours, and the letter wording.
 *
 * >>> IMPORTANT <<<
 * The wording below is ADAPTED from CB1's real travel letter plus UK
 * best-practice, but it is NOT legal advice. Have CB1's clinical/legal team
 * give it a final sign-off before real use.
 * ========================================================================== */

const CONFIG = {
  /* ---- Clinic (prescriber) details ------------------------------------- *
   * Taken from CB1's real letter (signature block). Verify if anything changes.
   * ---------------------------------------------------------------------- */
  clinic: {
    name: "CB1 Medical",
    addressLines: [
      "c/o Cross Street Surgery",
      "Hathern",
      "Leicestershire",
      "LE12 5LB",
    ],
    phone: "0116 273 1233",
    email: "enquiries@cb1medical.com",
    website: "cb1medical.com",
    registration: "CQC ID: 1-12789410247",                 // left blank (not shown on the real letter)
  },

  /* ---- Prescribing consultants, by type of care ------------------------ *
   * The patient picks their type of care; the matching consultant's name, GMC
   * and signature go on the letter. Each `id` must match a key in the
   * SIGNATURE_BLOBS map in signature.enc.js.
   * ---------------------------------------------------------------------- */
  careTypes: [
    {
      id: "pain",
      label: "Pain",
      doctor: { name: "Dr Simon Tordoff", title: "", gmc: "2884350" },
    },
    {
      id: "mental-health",
      label: "Mental Health",
      // Placeholder - supply Dr Delaffon's real signature (see tools/) and GMC.
      doctor: { name: "Dr Vijay Delaffon", title: "", gmc: "6071246" },
    },
  ],

  /* ---- Branding (CB1 dark green, sampled from the real letterhead) ------ */
  brand: {
    primaryColour: "#31453f",
    accentColour: "#26332f",
    // Self-hosted / system fonts only (no external font CDNs, for privacy).
    fontStack: '"Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },

  /* ---- Jurisdiction options (where the prescription was issued) -------- */
  jurisdictions: [
    "England", "Wales", "Scotland", "Northern Ireland",
    "Isle of Man", "Jersey", "Guernsey",
  ],

  /* ---- Letter wording -------------------------------------------------- *
   * Available placeholders (filled from the form automatically):
   *   {{patientName}}    {{patientDob}}      {{patientAddress}}
   *   {{jurisdiction}}   {{destination}}     {{departureDate}}
   *   {{returnDate}}     {{prescriptionNo}}  {{medication}}
   *   {{dose}}           {{quantity}}        {{issueDate}}
   *   {{clinicName}}     {{doctorName}}
   * ---------------------------------------------------------------------- */
  letter: {
    subject: "Re: Medical cannabis prescription for {{patientName}}'s travel",
    salutation: "To whom it may concern,",

    // Main body - one string per paragraph.
    bodyParagraphs: [
      "I am writing on behalf of my patient, {{patientName}} (date of birth {{patientDob}}), of {{patientAddress}}, who is under the care of {{clinicName}} and has been prescribed medical cannabis as an essential part of the ongoing management of their medical condition.",

      "{{patientName}} intends to travel to {{destination}}, departing on {{departureDate}} and returning on {{returnDate}}. For the duration of this trip they will carry the following prescribed medication for their own personal medical use:",

      // Medication detail line (rendered as an emphasised block).
      "{{medication}}, {{dose}}. Quantity carried: {{quantity}}. Prescription reference: {{prescriptionNo}}.||MED",

      "This medication is legally prescribed to the patient in {{jurisdiction}}, United Kingdom, under the Misuse of Drugs Regulations 2001. Consistent access to this treatment is central to maintaining the patient's health, and any interruption during travel risks a deterioration of their condition.",

      "I therefore request that {{patientName}} be permitted to carry the medication described above for the duration of their travel. Should you require verification of this prescription, please contact {{clinicName}} using the details on this letterhead.",
    ],

    // "Note for patient" section (traveller responsibilities + disclaimer).
    patientNotes: {
      heading: "Important information for the patient",
      intro: "This prescription is valid only within the jurisdiction in which it was issued ({{jurisdiction}}). It is your responsibility to check the specific regulations for your destination before you travel. You should:",
      steps: [
        "Check that every detail on this letter is correct before you rely on it, in particular the prescription reference, medication, dose and quantity. This letter is generated from the information you enter, and the details must match your actual prescription exactly.",
        "Contact the embassy or consulate of your destination country, and of any transit countries, for guidance on importing prescribed medical cannabis.",
        "Confirm with your airline their policy for carrying prescribed medication, including cannabis-based products.",
        "Travel with no more medication than you need for the trip, and keep this letter together with a copy of your prescription and your passport.",
      ],
      disclaimer: [
        "While {{clinicName}} provides this letter to support your travel, acceptance is determined solely by the laws of your destination and any transit countries and by airline policy. {{clinicName}} cannot accept responsibility for medication that is confiscated, or for any legal issues arising, outside the United Kingdom.",
        "Because this letter is completed using the information you enter, you are responsible for its accuracy. Airlines and border officials may compare it against your prescription and medication and may refuse it if the details do not match. {{clinicName}} does not accept liability for a letter that contains inaccurate or incomplete information.",
      ],
    },

    closing: "Yours faithfully,",
  },

  /* ---- Security note (shown to CB1 only, not printed) ------------------ *
   * The doctor's signature is stored ENCRYPTED (see signature.enc.js).
   * The access PIN is the decryption key - it is NOT stored anywhere in the
   * site in plaintext or as a hash. To change the PIN, re-run the offline
   * tool (tools/encrypt-signature.html or .mjs) - see README.md.
   * -------------------------------------------------------------------- */
};
