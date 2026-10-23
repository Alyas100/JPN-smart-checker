import { callGemini } from "../gemini/client.js";
import { fileToInlineDataPart } from "../gemini/fileUtils.js";
import { ocrFile, findPreciseBbox } from "../ocr/ocrUtils.js";

/**
 * @typedef {Object} FieldCheck
 * @property {string} field
 * @property {string} formValue
 * @property {string} attachmentValue
 * @property {'match'|'mismatch'|'unverifiable'} status
 * @property {string} source
 * @property {string} note
 * @property {{x:number,y:number,width:number,height:number} | null} attachmentBoundingBox
 */

/**
 * @typedef {Object} ComparisonResult
 * @property {'pass'|'fail'|'unverifiable'} overallStatus
 * @property {FieldCheck[]} checks
 * @property {string} summary
 */

const TEMPLATE_FIELDS = [
  // Child's Information
  { section: "Child's Information", name: "Child's Full Name" },
  { section: "Child's Information", name: "Child's Date of Birth" },
  { section: "Child's Information", name: "Child's Time of Birth" },
  { section: "Child's Information", name: "Child's Gender" },
  { section: "Child's Information", name: "Child's Place of Birth" },
  { section: "Child's Information", name: "Child's Birth Order" },
  { section: "Child's Information", name: "Child's Twin Position" },
  // Father's Information
  { section: "Father's Information", name: "Father's Full Name" },
  { section: "Father's Information", name: "Father's IC Number" },
  { section: "Father's Information", name: "Father's Date of Birth" },
  { section: "Father's Information", name: "Father's Citizenship" },
  { section: "Father's Information", name: "Father's Race" },
  { section: "Father's Information", name: "Father's Religion" },
  { section: "Father's Information", name: "Father's Address" },
  { section: "Father's Information", name: "Father's Postcode" },
  { section: "Father's Information", name: "Father's Phone Number" },
  // Mother's Information
  { section: "Mother's Information", name: "Mother's Full Name" },
  { section: "Mother's Information", name: "Mother's IC Number" },
  { section: "Mother's Information", name: "Mother's Date of Birth" },
  { section: "Mother's Information", name: "Mother's Citizenship" },
  { section: "Mother's Information", name: "Mother's Race" },
  { section: "Mother's Information", name: "Mother's Religion" },
  { section: "Mother's Information", name: "Mother's Address" },
  { section: "Mother's Information", name: "Mother's Postcode" },
  { section: "Mother's Information", name: "Mother's Phone Number" },
  { section: "Mother's Information", name: "Mother's Marital Status" },
  // Informant's Information
  { section: "Informant's Information", name: "Informant's Full Name" },
  { section: "Informant's Information", name: "Informant's IC Number" },
  { section: "Informant's Information", name: "Informant's Relationship to Child" },
  { section: "Informant's Information", name: "Informant's Address" },
  { section: "Informant's Information", name: "Informant's Postcode" },
  { section: "Informant's Information", name: "Informant's Phone Number" },
  { section: "Informant's Information", name: "Informant's Email" },
  // Witness's Information
  { section: "Witness's Information", name: "Witness's Full Name" },
  { section: "Witness's Information", name: "Witness's IC Number" },
  { section: "Witness's Information", name: "Witness's Address" },
  { section: "Witness's Information", name: "Witness's Postcode" },
  { section: "Witness's Information", name: "Witness's Phone Number" },
  { section: "Witness's Information", name: "Witness's Email" },
  // Birth Registration Details
  { section: "Birth Registration Details", name: "Child's Name (Registration)" },
  { section: "Birth Registration Details", name: "Date of Birth (Registration)" },
  { section: "Birth Registration Details", name: "Time of Birth (Registration)" },
  { section: "Birth Registration Details", name: "Place of Birth (Registration)" },
  { section: "Birth Registration Details", name: "District of Birth" },
  { section: "Birth Registration Details", name: "State of Birth" },
  { section: "Birth Registration Details", name: "Type of Birth" },
  { section: "Birth Registration Details", name: "Number of Births" },
  { section: "Birth Registration Details", name: "Birth Position" },
  { section: "Birth Registration Details", name: "Birth Weight" },
  { section: "Birth Registration Details", name: "Birth Length" },
  { section: "Birth Registration Details", name: "Gender (Registration)" },
];

const TEMPLATE_FIELD_NAMES = new Set(TEMPLATE_FIELDS.map((f) => f.name));

function ensureAllTemplateFields(checks) {
  const present = new Set(checks.map((c) => c.field));
  const merged = [...checks];
  for (const tpl of TEMPLATE_FIELDS) {
    if (!present.has(tpl.name)) {
      merged.push({
        field: tpl.name,
        formValue: "",
        attachmentValue: "",
        status: "unverifiable",
        source: "",
        note: "Field not found in attachments or not present on form.",
        attachmentBoundingBox: null,
      });
    }
  }
  return merged;
}

/**
 * Compares a filled-in form directly against one or more "absolute truth"
 * attachment files (e.g. an IC card image) using Gemini's vision.
 *
 * No OCR is involved here on purpose: earlier versions ran attachments
 * through local OCR first and compared text strings, which meant a garbled
 * OCR read became the "ground truth" the AI trusted. Sending the actual
 * images/PDF directly lets Gemini read both documents itself and do a
 * strict character-by-character comparison.
 *
 * @param {File} formFile - the filled-in form (image or PDF)
 * @param {File[]} attachmentFiles - supporting documents to check against (ground truth)
 * @returns {Promise<ComparisonResult>}
 */
export async function compareFilledFormWithAttachments(
  formFile,
  attachmentFiles,
  { signal } = {},
) {
  if (!attachmentFiles.length) {
    return {
      overallStatus: "unverifiable",
      checks: [],
      summary: "No attachments uploaded yet — nothing to compare against.",
    };
  }

  const formPart = await fileToInlineDataPart(formFile);
  const attachmentParts = await Promise.all(
    attachmentFiles.map(fileToInlineDataPart),
  );
  const attachmentLabels = attachmentFiles
    .map((f, i) => `[Attachment ${i + 1}: ${f.name}]`)
    .join("\n");

  const prompt = buildComparePrompt(attachmentLabels);

  const raw = await callGemini([
    { text: prompt },
    formPart,
    ...attachmentParts,
  ], { signal });
  console.log("[Gemini compare response]", raw);
  try {
    const parsed = JSON.parse(raw);
    const checks = Array.isArray(parsed.checks)
      ? parsed.checks.map(normalizeCheck)
      : [];
    const reconciled = ensureAllTemplateFields(
      reconcileDateChecks(reconcileNumericChecks(checks))
    );

    // Post-process: refine bounding boxes using Tesseract OCR
    console.log("[OCR] Starting bounding box refinement...");
    const ocrCache = new Map();
    for (const check of reconciled) {
      if (!check.attachmentBoundingBox || !check.source) continue;

      const sourceName = check.source.replace(/^Attachment\s*\d+:\s*/i, "").trim();
      const attachmentFile = attachmentFiles.find(
        (f) => f.name === sourceName || f.name.toLowerCase() === sourceName.toLowerCase(),
      );
      if (!attachmentFile) {
        console.log(`[OCR] SKIP "${check.field}" — no matching file for source "${sourceName}"`);
        continue;
      }

      if (!ocrCache.has(attachmentFile.name)) {
        try {
          const pages = await ocrFile(attachmentFile);
          ocrCache.set(attachmentFile.name, pages);
          console.log(`[OCR] ${attachmentFile.name}: ${pages.length} page(s) OCR'd`);
          for (const pg of pages) {
            console.log(`  page ${pg.page}: ${pg.words.length} words`);
            pg.words.slice(0, 10).forEach((w, i) => {
              console.log(`    word[${i}]: "${w.text}" x=${w.x.toFixed(3)} y=${w.y.toFixed(3)} w=${w.width.toFixed(3)} h=${w.height.toFixed(3)}`);
            });
          }
        } catch (e) {
          console.warn(`[OCR] Failed for ${attachmentFile.name}:`, e);
          ocrCache.set(attachmentFile.name, []);
        }
      }

      const pages = ocrCache.get(attachmentFile.name);
      if (!pages || !pages.length) {
        console.log(`[OCR] SKIP "${check.field}" — no OCR data for "${attachmentFile.name}"`);
        continue;
      }

      const fieldPage = check.page || 1;
      let pageData = pages.find(p => p.page === fieldPage) || pages[0];
      let words = pageData?.words || [];
      let precise = findPreciseBbox(check.attachmentValue, words, check.attachmentBoundingBox);

      // Gemini may omit the page even when its bounding box is accurate. In
      // that case, a match on page 1 must not prevent us from checking the
      // remaining pages for the value's actual location.
      if (pages.length > 1 && !check.pageProvided) {
        const candidates = [];
        for (const pg of pages) {
          const candidate = findPreciseBbox(
            check.attachmentValue,
            pg.words,
            check.attachmentBoundingBox,
          );
          if (candidate) candidates.push({ page: pg, bbox: candidate });
        }
        if (candidates.length) {
          const hint = check.attachmentBoundingBox;
          const distance = ({ bbox }) => {
            if (!hint) return 0;
            const bboxCenter = { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
            const hintCenter = { x: hint.x + hint.width / 2, y: hint.y + hint.height / 2 };
            return Math.hypot(bboxCenter.x - hintCenter.x, bboxCenter.y - hintCenter.y);
          };
          const best = candidates.reduce((current, candidate) =>
            distance(candidate) < distance(current) ? candidate : current
          );
          pageData = best.page;
          words = pageData.words;
          precise = best.bbox;
          check.page = pageData.page;
          console.log(`[OCR] Page was not supplied; resolved "${check.field}" to page ${pageData.page}`);
        }
      } else if (!precise && pages.length > 1) {
        console.log(`[OCR] Not found on page ${fieldPage}, searching all ${pages.length} pages...`);
        for (const pg of pages) {
          if (pg.page === fieldPage) continue;
          const pgPrecise = findPreciseBbox(check.attachmentValue, pg.words, check.attachmentBoundingBox);
          if (pgPrecise) {
            console.log(`[OCR] Found on page ${pg.page} instead!`);
            precise = pgPrecise;
            pageData = pg;
            words = pg.words;
            check.page = pg.page;
            break;
          }
        }
      }

      console.log(`[OCR] Matching "${check.field}" value="${check.attachmentValue}" against page ${pageData?.page || '?'} (${words.length} words, ${pageData?.liveText ? 'live text layer' : 'Tesseract OCR'})`);
      if (precise) {
        console.log(`[OCR] ✅ Refined "${check.field}": Gemini had (${check.attachmentBoundingBox.x.toFixed(3)}, ${check.attachmentBoundingBox.y.toFixed(3)}) → Tesseract got (${precise.x.toFixed(3)}, ${precise.y.toFixed(3)}, w=${precise.width.toFixed(3)}, h=${precise.height.toFixed(3)})`);
        check.attachmentBoundingBox = {
          x: Math.max(0, Math.min(1, precise.x)),
          y: Math.max(0, Math.min(1, precise.y)),
          width: Math.max(0, Math.min(1, precise.width)),
          height: Math.max(0, Math.min(1, precise.height)),
        };
        check.page = pageData.page;
      } else {
        console.log(`[OCR] ❌ No match for "${check.field}" value="${check.attachmentValue}" — keeping Gemini bbox`);
        if (
          check.field === "Child's Date of Birth" ||
          check.field === "Child's Time of Birth" ||
          check.field === "Date of Birth (Registration)" ||
          check.field === "Time of Birth (Registration)"
        ) {
          check.attachmentBoundingBox = null;
        }
      }
    }
    console.log("[OCR] Bounding box refinement complete.");

    const overallStatus = deriveOverallStatus(reconciled);

    return {
      overallStatus,
      checks: reconciled,
      summary: summarize(overallStatus, reconciled),
    };
  } catch {
    return {
      overallStatus: "unverifiable",
      checks: [],
      summary: "Could not parse the AI comparison response. Try again.",
    };
  }
}

function buildComparePrompt(attachmentLabels) {
  const fieldList = TEMPLATE_FIELDS.map((f) => `- ${f.name}`).join("\n");
  return `You are comparing a FILLED-IN FORM against one or more ABSOLUTE TRUTH attachment
documents (e.g. an identity card, birth certificate). Look directly at the images/PDF
provided yourself — do not rely on any external text extraction.

The FIRST document provided is the FILLED FORM.
The documents after that are the ATTACHMENTS (ground truth), in this order:
${attachmentLabels}

TASK — You MUST check EVERY field listed below against the attachments. For each field,
read the value on the form and the value on the matching attachment, then compare.
If a field is not visible on the form or not filled in, still include it with status
"unverifiable" and note "Field not present on form."
If a field is on the form but no attachment covers it, mark "unverifiable" and note
"Field not found in attachment."

CHECKLIST — you must return a result for ALL of these fields:
${fieldList}

IMPORTANT — How to read the filled form:
The form is a digital PDF with individual character boxes (one letter per box). When a value
is too long to fit in a single row of boxes, it CONTINUES on the row directly below it.
You must read ALL consecutive rows that belong to the same field and join them together.
For example, if the Mother's Name field looks like this:
  [A][N][I][S][ ][A][D][I][L][A][H]
  [B][I][N][T][I][ ][A][B][D][U][L]
  [G][H][A][N][I]
the full name is "ANIS ADILAH BINTI ABDUL GHANI" — do NOT read only the first row.
Look at the visual layout of the form: fields are arranged vertically (Father's Name,
Father's IC, Mother's Name, Mother's IC, etc.). When text from one field overflows into
the next row of boxes, the NEXT field's label will appear further down the form — use
these labels as delimiters to know where one field ends and another begins.

For each such field:
1. Read the exact value as written on the FORM.
2. Read the exact value as written on the matching ATTACHMENT.
3. Compare them character-by-character / digit-by-digit. Do NOT consider two values a match
   unless every character is identical. If even a single digit or letter differs, it is a
   "mismatch" — do not be lenient, and do not assume a visually similar value is correct.
   EXCEPTION — Date fields: if both values represent the same calendar date but use
   different formatting (e.g. "29-03-1992" vs "29 MAC 1992" vs "29/03/1992" vs
   "29 March 1992"), consider them a MATCH. Normalise the month name to its number
   (JANUARI/January=01, FEBRUARI/February=02, MAC/March=03, APRIL=04, MEI/May=05,
   JUN/June=06, JULAI/July=07, OGOS/August=08, SEPTEMBER=09, OKTOBER/October=10,
   NOVEMBER=11, DISEMBER/December=12) before comparing. If the day, month, or year
   are actually different, that is still a MISMATCH.
4. If a field appears on the form but no attachment shows that same field, mark it
   "unverifiable" instead of guessing.

CHECKBOX RULE — child's gender, birth order, twin position, type of birth, number of
births, birth position, and gender (registration) are tick-box / checkbox fields.
When reading these on the form, ONLY report a value for the ONE box that has a visible
tick or cross mark (✓, ✗, X, or a filled box). To decide whether a box is ticked, compare
the mark clearly against the other empty boxes in that row. If NO box in the field has any
tick at all — or if you are not certain which (if any) box is marked — do NOT guess, do NOT
invent a tick, and do NOT fill in a value just because one of the options seems likely or is
known to be true. Set status to "unverifiable" with BOTH formValue "" AND attachmentValue ""
and note "Checkbox not ticked on form." Leave the source empty and bounding box null.
NEVER hallucinate a mark — correctness is more important than completing every field.

ADDRESS RULE — For the residential address fields (the "alamat tempat tinggal" /
current home address for Father and Mother) and their postcodes, read the address ONLY
from a utility bill attachment (e.g. bil utiliti, electricity/water bill) that lists the
couple's current home address. Do NOT read the address from an identity card (IC/MyKad) —
the IC address is often the OLD address and is not reliable. Also do NOT use the marriage
certificate for the address unless the marriage certificate explicitly lists a current
residential address. If no utility bill shows the address, mark the address field
"unverifiable" with note "Current address not found on utility bill" rather than copying
the IC address.

SOURCE TABLE — Each field below has a DETERMINISTIC, single accepted source. Read each
field ONLY from the attachment named. If that attachment is not provided, or the field is
not readable on it, mark the field "unverifiable" — do NOT fall back to another attachment
unless stated.

CHILD'S INFORMATION (source: borang pengesahan kelahiran form = "borang-pengesahan-kelahiran-filled.pdf"):
- Child's Full Name → borang-pengesahan-kelahiran-filled.pdf (Child's name)
- Child's Date of Birth → borang-pengesahan-kelahiran-filled.pdf (date of birth)
- Child's Time of Birth → borang-pengesahan-kelahiran-filled.pdf (time of birth)
- Child's Gender → borang-pengesahan-kelahiran-filled.pdf (sex)
- Child's Place of Birth → borang-pengesahan-kelahiran-filled.pdf (place of birth)
- Child's Birth Order → borang-pengesahan-kelahiran-filled.pdf (birth order)
- Child's Twin Position → unverifiable (no matching field in attachments; do not infer from birth order)

FATHER'S INFORMATION:
- Father's Full Name → "MyKad lelaki.jpeg" (full name)
- Father's IC Number → "MyKad lelaki.jpeg" (identity card number)
- Father's Date of Birth → marriage certificate ("sijil nikah laki by ai.png") — not the IC, the IC does not print DOB
- Father's Citizenship → "MALAYSIA" — the warganegara is always "MALAYSIA". Compare the
  form's warganegara value against "MALAYSIA"; optionally confirm on "MyKad lelaki.jpeg"
  if readable, otherwise still treat "MALAYSIA" as the expected truth.
- Father's Race → borang-pengesahan-kelahiran-filled.pdf — read ONLY from the FATHER'S /
  "bapa" section of that form (the race/bangsa entry under Father's details). Do NOT take
  the value from the MOTHER'S section even if both races are the same (e.g. both "MELAYU").
- Father's Religion → "MyKad lelaki.jpeg" (religion) if visible, otherwise unverifiable
- Father's Address → utility bill ("bil utiliti.png") ONLY, otherwise unverifiable
- Father's Postcode → utility bill ("bil utiliti.png") ONLY, otherwise unverifiable
- Father's Phone Number → "complete-filled-buku-pink.pdf" (husband's telephone) if present, otherwise unverifiable

MOTHER'S INFORMATION:
- Mother's Full Name → "MyKad pp.jpeg" (full name)
- Mother's IC Number → "MyKad pp.jpeg" (identity card number)
- Mother's Date of Birth → marriage certificate ("sijil nikah pp by ai.png") — not the IC, the IC does not print DOB
- Mother's Citizenship → "MALAYSIA" — the warganegara is always "MALAYSIA". Compare the
  form's warganegara value against "MALAYSIA"; optionally confirm on "MyKad pp.jpeg" if
  readable, otherwise still treat "MALAYSIA" as the expected truth.
- Mother's Race → borang-pengesahan-kelahiran-filled.pdf — read ONLY from the MOTHER'S /
  "ibu" section of that form (the race/bangsa entry under Mother's details). Do NOT take
  the value from the FATHER'S section even if both races are the same (e.g. both "MELAYU").
- Mother's Religion → "MyKad pp.jpeg" (religion) if visible, otherwise unverifiable
- Mother's Address → utility bill ("bil utiliti.png") ONLY, otherwise unverifiable
- Mother's Postcode → utility bill ("bil utiliti.png") ONLY, otherwise unverifiable
- Mother's Phone Number → "complete-filled-buku-pink.pdf" (mother's telephone) if present, otherwise unverifiable
- Mother's Marital Status → marriage certificate ("sijil nikah") as evidence the marriage record exists; if the cert does not explicitly state a marital status, mark unverifiable rather than inventing one

INFORMANT'S INFORMATION:
- Informant's Full Name → borang-pengesahan-kelahiran-filled.pdf (parent/informant name) only if the informant is identified there; otherwise unverifiable
- Informant's IC Number → borang-pengesahan-kelahiran-filled.pdf (informant IC) only if the same informant is identified; otherwise unverifiable
- Informant's Relationship to Child → unverifiable (do not infer from the person's name)
- Informant's Address → borang-pengesahan-kelahiran-filled.pdf only when the informant is identified as the parent; otherwise unverifiable
- Informant's Postcode → borang-pengesahan-kelahiran-filled.pdf (same identity constraint as Informant's Address)
- Informant's Phone Number → unverifiable
- Informant's Email → unverifiable

WITNESS'S INFORMATION (all fields → unverifiable — no witness identity source in the attachments).

BIRTH REGISTRATION DETAILS (source: borang pengesahan kelahiran form unless stated):
- Child's Name (Registration) → borang-pengesahan-kelahiran-filled.pdf (same value as Child's Full Name)
- Date of Birth (Registration) → borang-pengesahan-kelahiran-filled.pdf (same value as Child's Date of Birth)
- Time of Birth (Registration) → borang-pengesahan-kelahiran-filled.pdf (same value as Child's Time of Birth)
- Place of Birth (Registration) → borang-pengesahan-kelahiran-filled.pdf (same value as Child's Place of Birth)
- District of Birth → borang-pengesahan-kelahiran-filled.pdf (district) if explicitly present; otherwise unverifiable
- State of Birth → borang-pengesahan-kelahiran-filled.pdf (state) if explicitly present; otherwise unverifiable
- Type of Birth → this field on the form means "dalam perkahwinan" / "luar perkahwinan"
  (whether the child was born within a marriage). Do NOT compare it against any
  "jenis kelahiran" / delivery-method field on the borang pengesahan kelahiran or pink book,
  because those mean the delivery type (normal, C-section, etc.) and are a different concept.
  Verify it from the marriage certificate if the certificate makes clear the child was or
  was not born within the marriage; otherwise mark unverifiable.
- Number of Births → borang-pengesahan-kelahiran-filled.pdf (number of births)
- Birth Position → borang-pengesahan-kelahiran-filled.pdf (birth position); do not substitute number of births
- Birth Weight → "complete-filled-buku-pink.pdf" (child's weight at birth)
- Birth Length → "complete-filled-buku-pink.pdf" (child's length at birth)
- Gender (Registration) → borang-pengesahan-kelahiran-filled.pdf (same value as Child's Gender)

The "source" field in your JSON output must be the filename of the attachment you actually
read the attachmentValue from, matching exactly one of the types described above.

IC-FIRST RULE — For the following fields, the IC card (MyKad) is the most absolute
truth source. You MUST read these fields ONLY from the IC attachment, not from any other
attachment:
  - Father's Full Name → read from Father's IC only
  - Father's IC Number → read from Father's IC only
  - Father's Citizenship (warganegara) → read from Father's IC if visible, otherwise unverifiable
  - Father's Religion (agama) → read from Father's IC if visible, otherwise unverifiable
  - Mother's Full Name → read from Mother's IC only
  - Mother's IC Number → read from Mother's IC only
  - Mother's Citizenship (warganegara) → read from Mother's IC if visible, otherwise unverifiable
  - Mother's Religion (agama) → read from Mother's IC if visible, otherwise unverifiable
If the IC attachment is not provided or the field is not visible/detectable on the IC, mark
the field "unverifiable" with note "IC card not available or field not readable on IC" rather
than reading from a different attachment.

HANDWRITING / CROSS-OUT RULE — The form may be filled in by HAND. Human writers often
strike through, cross out, or scribble over individual letters or whole words they got
wrong, and sometimes write a correct letter/number next to or above the deletion. When
reading the form:
  - If a single LETTER (or digit) within a word is crossed out or scribbled over, IGNORE
    only that one letter and read the rest of the word as normal. For example, if the name
    is written "Ro[bert" with the "b" crossed out, the intended value is "Robert" — keep
    all the correct letters and drop only the struck-out one. If a corrected letter was
    written beside/above it, use that corrected letter in its place.
  - If a WHOLE word (or several characters) are crossed out, ignore the entire crossed-out
    run and take the surviving text.
Read the formValue as the FINAL, de-corrupted value (dropping only the crossed-out
characters and keeping every other correct letter). Do NOT include crossed-out letters in
the formValue, and do NOT compare the deleted text against the attachment. Only the
surviving, non-crossed-out text is what was intended.

FIELD-EXACT RULE — When reading a value from the FORM, you must read it from the EXACT
field labeled for that purpose. Do NOT substitute a value from a different field even if
the values are logically the same or similar. Specifically:
  - Child's Date of Birth ("tarikh lahir bayi") → read ONLY from the "tarikh kelahiran"
    field on the form. Do NOT use "tarikh masuk" or any other date field.
  - Child's Time of Birth ("masa kelahiran") → read ONLY from the "masa kelahiran" field.
    Do NOT use any other time field.
  - Father's/Mother's Date of Birth → read ONLY from the corresponding date-of-birth
    field for that parent. Do NOT reuse the child's date or any other date.
Each field on the form has its own labeled entry box — read from THAT box and no other.

Respond with ONLY compact JSON, no markdown, in this exact shape:
{
  "checks": [
    {
      "field": "<field name from the checklist above>",
      "formValue": "<exact value as written on the form, or empty string if not filled>",
      "attachmentValue": "<exact value as written on the attachment, or empty string if unverifiable>",
      "status": "match" | "mismatch" | "unverifiable",
      "source": "<which attachment file this came from, or empty string>",
      "note": "<one short sentence; for mismatches, say exactly what differs>",
      "attachmentBoundingBox": { "x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0 } or null,
      "page": 1
    }
  ]
}

attachmentBoundingBox RULES:
- For each field where you found a value on an attachment, provide the bounding box coordinates
  of WHERE that value is located on the attachment image/PDF.
- Also provide a "page" field: the 1-based page number of the attachment where the value is found.
  For images, always use page 1. For PDFs, use the actual page number where the text appears.
- Coordinates are NORMALIZED (0.0 to 1.0) relative to THAT page's dimensions:
  x = left edge position (0.0 = left edge, 1.0 = right edge)
  y = top edge position (0.0 = top edge, 1.0 = bottom edge)
  width = how wide the box is (e.g. 0.15 = 15% of document width)
  height = how tall the box is (e.g. 0.03 = 3% of document height)
- The box should tightly enclose the VALUE TEXT only (not the field label).
- Use 3 decimal places of precision (e.g. 0.342, not 0.3).
- Estimate coordinates by carefully counting where the text starts and ends
  relative to the full page dimensions — do not guess randomly.
- If you cannot determine the position, set it to null.
- The box will be drawn on the document to help the user locate the field — accuracy matters.

IMPORTANT: Return a check for EVERY field in the checklist above, even if unverifiable.`;
}

function normalizeCheck(c) {
  const bb = c?.attachmentBoundingBox;
  const pageProvided = typeof c?.page === "number" && Number.isFinite(c.page) && c.page >= 1;
  let boundingBox = null;
  if (bb && typeof bb === 'object' && typeof bb.x === 'number' && typeof bb.y === 'number'
      && typeof bb.width === 'number' && typeof bb.height === 'number') {
    boundingBox = {
      x: Math.max(0, Math.min(1, bb.x)),
      y: Math.max(0, Math.min(1, bb.y)),
      width: Math.max(0, Math.min(1, bb.width)),
      height: Math.max(0, Math.min(1, bb.height)),
    };
  }
  return {
    field: c?.field != null ? String(c.field) : "Unknown field",
    formValue: c?.formValue != null ? String(c.formValue) : "",
    attachmentValue:
      c?.attachmentValue != null ? String(c.attachmentValue) : "",
    status: ["match", "mismatch", "unverifiable"].includes(c?.status)
      ? c.status
      : "unverifiable",
    source: c?.source != null ? String(c.source) : "",
    note: c?.note != null ? String(c.note) : "",
    attachmentBoundingBox: boundingBox,
    page: pageProvided ? Math.round(c.page) : 1,
    pageProvided,
  };
}

function digitsOnly(str) {
  return String(str ?? "").replace(/\D/g, "");
}

/**
 * Deterministic backstop for numeric identifiers (IC/NRIC, phone numbers,
 * etc.): if the AI claims two values "match" but their digit strings
 * aren't actually identical once formatting is stripped, downgrade it to
 * a mismatch rather than trusting the AI's judgement alone. This exists
 * specifically to catch the case where a couple of digits get changed but
 * the AI still eyeballs it as "close enough".
 */
function reconcileNumericChecks(checks) {
  return checks.map((check) => {
    const formDigits = digitsOnly(check.formValue);
    const attachmentDigits = digitsOnly(check.attachmentValue);

    // Only apply to values that look like a substantial numeric identifier.
    if (formDigits.length < 6 || attachmentDigits.length < 6) return check;

    const digitsMatch = formDigits === attachmentDigits;

    if (check.status === "match" && !digitsMatch) {
      return {
        ...check,
        status: "mismatch",
        note: `Automated digit re-check found a discrepancy: form reads "${check.formValue}", attachment reads "${check.attachmentValue}".`,
      };
    }

    if (check.status !== "match" && digitsMatch && check.attachmentValue) {
      return {
        ...check,
        status: "match",
        note: check.note || "Confirmed by automated digit re-check.",
      };
    }

    return check;
  });
}

/**
 * Deterministic backstop for date fields: if the AI flagged a mismatch
 * but both values are actually the same calendar date written in
 * different formats (e.g. "29-03-1992" vs "29 MAC 1992"), upgrade it
 * to a match so the user is not nagged about formatting differences.
 */
const MONTH_MAP = {
  jan: 1, januari: 1, january: 1,
  feb: 2, februari: 2, february: 2,
  mar: 3, mac: 3, march: 3,
  apr: 4, april: 4,
  may: 5, mei: 5,
  jun: 6, june: 6,
  jul: 7, julai: 7, july: 7,
  aug: 8, ogos: 8, august: 8,
  sep: 9, september: 9,
  oct: 10, oktober: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, disember: 12, december: 12,
};

function parseDateComponents(str) {
  if (!str) return null;
  const s = String(str).trim();

  // DD-MM-YYYY / DD.MM.YYYY / DD/MM/YYYY / DD-MM-YYYY with optional whitespace around separators
  let m = s.match(/(\d{1,2})\s*[.\-/]\s*(\d{1,2}|[a-z]+)\s*[.\-/]\s*(\d{4})/i);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = /^\d+$/.test(m[2])
      ? parseInt(m[2], 10)
      : MONTH_MAP[m[2].toLowerCase()];
    const year = parseInt(m[3], 10);
    if (day && month && year) return { day, month, year };
  }

  // YYYY-MM-DD / YYYY.MM.DD / YYYY/MM/DD
  m = s.match(/(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/);
  if (m) {
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);
    if (day && month && year) return { day, month, year };
  }

  // DD Month YYYY  (e.g. "29 March 1992", "29 MAC 1992")
  m = s.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/i);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = MONTH_MAP[m[2].toLowerCase()];
    const year = parseInt(m[3], 10);
    if (day && month && year) return { day, month, year };
  }

  return null;
}

function reconcileDateChecks(checks) {
  return checks.map((check) => {
    // Only correct mismatches — leave matches and unverifiable alone.
    if (check.status !== "mismatch") return check;

    const d1 = parseDateComponents(check.formValue);
    const d2 = parseDateComponents(check.attachmentValue);

    if (d1 && d2 && d1.day === d2.day && d1.month === d2.month && d1.year === d2.year) {
      return {
        ...check,
        status: "match",
        note: check.note || "Confirmed by automated date normalisation — same date, different format.",
      };
    }

    return check;
  });
}

function deriveOverallStatus(checks) {
  if (!checks.length) return "unverifiable";
  return checks.some((c) => c.status === "mismatch") ? "fail" : "pass";
}

function summarize(overallStatus, checks) {
  if (overallStatus === "unverifiable") return "Nothing could be verified yet.";
  const mismatches = checks.filter((c) => c.status === "mismatch");
  if (mismatches.length) {
    return `${mismatches.length} field${mismatches.length === 1 ? "" : "s"} did not match: ${mismatches
      .map((m) => m.field)
      .join(", ")}.`;
  }
  return "All checked fields matched.";
}
