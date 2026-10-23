import { createWorker } from "tesseract.js";

let worker = null;

async function getWorker() {
  if (!worker) {
    worker = await createWorker("eng+msa", 1, {
      logger: (m) => {
        if (m.status === "recognizing text") {
          console.log(`[Tesseract] ${(m.progress * 100).toFixed(0)}%`);
        }
      },
    });
  }
  return worker;
}

/**
 * Renders a PDF page to a canvas data URL via pdfjs-dist.
 * Returns { dataUrl, naturalW, naturalH }.
 */
async function pdfToDataUrl(file, pageNumber = 1) {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).href;

  const arrayBuf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
  const clampedPage = Math.min(pageNumber, pdf.numPages);
  const page = await pdf.getPage(clampedPage);
  const viewport = page.getViewport({ scale: 3 });

  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;

  return { dataUrl: canvas.toDataURL("image/png"), naturalW: viewport.width, naturalH: viewport.height };
}

/**
 * Gets natural dimensions of an image file.
 */
function getImageDimensions(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ naturalW: img.naturalWidth, naturalH: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ naturalW: 1, naturalH: 1 });
    };
    img.src = url;
  });
}

/**
 * Determines whether a PDF page has REAL embedded text (a text layer),
 * e.g. a form filled digitally. Returns boolean.
 */
async function pdfPageHasLiveText(pdf, pageNumber) {
  try {
    const page = await pdf.getPage(pageNumber);
    const tc = await page.getTextContent();
    const meaningful = tc.items.filter((i) => i.str && i.str.trim()).length;
    return meaningful >= 3;
  } catch {
    return false;
  }
}

/**
 * Extracts words with exact positions directly from a PDF page's text layer.
 * Uses getTextContent() — no OCR needed. Coordinates are normalized 0-1
 * relative to the page, matching the same shape Tesseract returns.
 */
async function pdfLiveTextWords(pdf, pageNumber) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();

  const words = [];
  for (const item of tc.items) {
    if (!item.str || !item.str.trim()) continue;
    const [x1, y1] = viewport.convertToViewportPoint(
      item.transform[4],
      item.transform[5],
    );
    const [x2, y2] = viewport.convertToViewportPoint(
      item.transform[4] + (typeof item.width === "number" ? item.width : 0),
      item.transform[5] + (typeof item.height === "number" ? item.height : 0),
    );
    const w = Math.abs(x2 - x1);
    const h = Math.abs(y2 - y1);
    words.push({
      text: item.str.trim(),
      x: x1 / viewport.width,
      y: y1 / viewport.height,
      width: (w > 0 ? w : 0.02 * viewport.width) / viewport.width,
      height: (h > 0 ? h : 0.01 * viewport.height) / viewport.height,
    });
  }
  return words;
}

/**
 * Runs OCR on a file (image or PDF) and returns word-level bounding boxes
 * normalized to 0-1 coordinates.
 *
 * For PDFs: if a page has a REAL embedded text layer (e.g. digitally filled
 * form), words are extracted with EXACT positions straight from the PDF —
 * no OCR involved. If the page has no live text (scanned / handwritten),
 * Tesseract OCR is used instead, per page.
 *
 * Returns an array of per-page { page, words, naturalW, naturalH } entries.
 * Coordinates are always normalized within their own page.
 */
export async function ocrFile(file) {
  const isPdf =
    file.type === "application/pdf" || /\.pdf$/i.test(file.name);

  const w = await getWorker();

  async function recognizeSource(imageSource, naturalW, naturalH) {
    const { data } = await w.recognize(imageSource, {}, { blocks: true });

    // Flatten words from blocks > paragraphs > lines > words
    const allWords = [];
    const blocks = data.blocks || [];
    for (const block of blocks) {
      for (const para of block.paragraphs || []) {
        for (const line of para.lines || []) {
          for (const word of line.words || []) {
            allWords.push(word);
          }
        }
      }
    }

    // Fallback: if blocks structure is empty, try data.words directly
    const wordList = allWords.length > 0 ? allWords : (data.words || []);

    return wordList
      .filter((word) => word.text && word.text.trim())
      .map((word) => {
        const b = word.bbox;
        return {
          text: word.text.trim(),
          x: b.x0 / naturalW,
          y: b.y0 / naturalH,
          width: (b.x1 - b.x0) / naturalW,
          height: (b.y1 - b.y0) / naturalH,
        };
      });
  }

  if (isPdf) {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).href;
    const arrayBuf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
    const numPages = pdf.numPages;

    const pages = [];
    for (let p = 1; p <= numPages; p++) {
      if (await pdfPageHasLiveText(pdf, p)) {
        // A PDF can contain a live template text layer while handwritten or
        // image-overlay values exist only in the rendered page. OCR the full
        // page so those values are not skipped.
        const liveWords = await pdfLiveTextWords(pdf, p);
        const { dataUrl, naturalW, naturalH } = await pdfToDataUrl(file, p);
        const ocrWords = await recognizeSource(dataUrl, naturalW, naturalH);
        const words = ocrWords.length > 0 ? ocrWords : liveWords;
        console.log(`[OCR] pdf ${file.name} page ${p}: live text + rendered-page OCR (${ocrWords.length} OCR words, ${liveWords.length} embedded words)`);
        pages.push({ page: p, words, liveText: ocrWords.length === 0, naturalW, naturalH });
        continue;
      }
      const { dataUrl, naturalW, naturalH } = await pdfToDataUrl(file, p);
      const words = await recognizeSource(dataUrl, naturalW, naturalH);
      console.log(`[OCR] pdf ${file.name} page ${p}: NO live text → Tesseract OCR (${words.length} words)`);
      pages.push({ page: p, words, liveText: false, naturalW, naturalH });
    }
    return pages;
  }

  const dims = await getImageDimensions(file);
  const naturalW = dims.naturalW;
  const naturalH = dims.naturalH;
  const words = await recognizeSource(file, naturalW, naturalH);
  console.log(`[OCR] image ${file.name}: Tesseract OCR (${words.length} words)`);
  return [{ page: 1, words, liveText: false, naturalW, naturalH }];
}

/**
 * Finds precise bounding box for a value string from OCR words.
 * Uses character-level sliding window with spatial proximity filtering.
 * If hintBbox is provided, prefers matches closest to that location.
 * Returns normalized { x, y, width, height } or null.
 */
export function findPreciseBbox(value, ocrWords, hintBbox) {
  if (!value || !ocrWords?.length) return null;

  const valNorm = value.replace(/\s+/g, "").toLowerCase();
  if (!valNorm) return null;

  // Build joined string with character-to-word mapping
  const charMap = [];
  let joined = "";
  for (let i = 0; i < ocrWords.length; i++) {
    const stripped = ocrWords[i].text.replace(/\s+/g, "").toLowerCase();
    for (let c = 0; c < stripped.length; c++) {
      joined += stripped[c];
      charMap.push({ wordIndex: i });
    }
  }

  // Strategy 1: Exact substring match
  const exactIdx = joined.indexOf(valNorm);
  if (exactIdx < 0 && (valNorm.includes("-") || valNorm.includes(":") || valNorm.includes("/") || valNorm.includes("."))) {
    console.log(`[OCR-dbg] "${value}": joined has "${joined}" (len ${joined.length}), target "${valNorm}" NOT found exact`);
  }
  if (exactIdx >= 0) {
    const bbox = buildBboxFromRange(charMap, ocrWords, exactIdx, exactIdx + valNorm.length - 1);
    if (!hintBbox) return bbox;
    // If multiple exact matches possible, collect all and pick closest to hint
    const allMatches = findAllExactMatches(joined, valNorm, charMap, ocrWords);
    return pickClosest(allMatches, hintBbox);
  }

  // Strategy 2: Alpha-only exact match
  const valAlpha = valNorm.replace(/[^a-z0-9]/g, "");
  const alphaCharMap = [];
  const alphaJoined = [];
  for (let i = 0; i < joined.length; i++) {
    if (/[a-z0-9]/.test(joined[i])) {
      alphaCharMap.push(charMap[i]);
      alphaJoined.push(joined[i]);
    }
  }
  const alphaStr = alphaJoined.join("");
  const alphaIdx = alphaStr.indexOf(valAlpha);
  if (alphaIdx < 0) {
    console.log(`[OCR-dbg] "${value}": alpha joined = "${alphaStr}" (len ${alphaStr.length}), target alpha "${valAlpha}" NOT found, candidates: 0`);
  }
  if (alphaIdx >= 0) {
    const allMatches = findAllExactMatches(alphaStr, valAlpha, alphaCharMap, ocrWords);
    return pickClosest(allMatches, hintBbox);
  }

  // Strategy 3: Sliding window with spatial check
  let candidates = [];
  for (let i = 0; i <= alphaStr.length - valAlpha.length; i++) {
    let score = 0;
    for (let j = 0; j < valAlpha.length; j++) {
      if (alphaStr[i + j] === valAlpha[j]) score++;
    }
    const ratio = score / valAlpha.length;
    if (ratio >= 0.8) {
      const startWI = alphaCharMap[i].wordIndex;
      const endWI = alphaCharMap[i + valAlpha.length - 1].wordIndex;
      const words = ocrWords.slice(startWI, endWI + 1);
      const ys = words.map((w) => w.y);
      const yRange = Math.max(...ys) - Math.min(...ys);
      const avgHeight = words.reduce((s, w) => s + w.height, 0) / words.length;
      if (yRange <= avgHeight * 2.5) {
        candidates.push(buildBboxFromRange(alphaCharMap, ocrWords, i, i + valAlpha.length - 1));
      }
    }
  }

  if (candidates.length > 0) return pickClosest(candidates, hintBbox);
  return null;
}

function findAllExactMatches(joined, target, charMap, words) {
  const matches = [];
  let idx = 0;
  while ((idx = joined.indexOf(target, idx)) !== -1) {
    matches.push(buildBboxFromRange(charMap, words, idx, idx + target.length - 1));
    idx++;
  }
  return matches;
}

function pickClosest(bboxes, hintBbox) {
  if (!bboxes.length) return null;
  if (bboxes.length === 1 || !hintBbox) return bboxes[0];

  const hy = hintBbox.y + hintBbox.height / 2;

  let best = bboxes[0];
  let bestY = Infinity;
  for (const bb of bboxes) {
    const cy = bb.y + bb.height / 2;
    const yDist = Math.abs(cy - hy);
    // Prefer matches on the same row (small Y distance) — row alignment matters most
    if (yDist < bestY) {
      bestY = yDist;
      best = bb;
    }
  }
  return best;
}

function buildBboxFromRange(charMap, words, startIdx, endIdx) {
  const startWI = charMap[startIdx].wordIndex;
  const endWI = charMap[endIdx].wordIndex;
  const first = words[startWI];
  const last = words[endWI];
  return {
    x: first.x,
    y: first.y,
    width: last.x + last.width - first.x,
    height: last.y + last.height - first.y,
  };
}

export async function terminateOcr() {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
}
