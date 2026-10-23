# JPN Smart Checker

An AI-assisted document verification system for Malaysian birth registration
forms. The application compares a completed JPN form with supporting
documents, identifies matching and mismatching values, and highlights the
source value directly on the uploaded document.

This is a personal portfolio project built to demonstrate practical frontend
development, document processing, OCR integration, and responsible use of
generative AI.

## Why I built this

Manual document checking is repetitive and errors can be difficult to spot
when information is spread across forms, identity documents, and multi-page
PDFs. JPN Smart Checker explores how AI can assist an officer or reviewer by
organising the comparison workflow while keeping the individual results
visible and reviewable.

## Features

- Upload one completed form and multiple supporting attachments.
- Accept image files and PDF documents.
- Compare predefined birth-registration fields with Gemini AI.
- Return field-level `match`, `mismatch`, or `unverifiable` results.
- Apply deterministic checks to numeric values after AI comparison.
- Use Tesseract.js OCR to refine value-level bounding boxes.
- Render PDF pages with PDF.js and open the page where a value was found.
- Highlight the detected value on the document preview.
- Export a comparison report as a PDF.
- Cancel an in-progress comparison request.
- Simulate a successful JPN registration workflow for demonstration purposes.

## Technology

- **Frontend:** JavaScript, Svelte 5, Vite
- **AI:** Google Gemini API
- **OCR:** Tesseract.js with English and Malay language support
- **PDF processing:** PDF.js
- **Report generation:** jsPDF and jsPDF AutoTable
- **State management:** Svelte 5 reactive state

## How it works

1. The user uploads a filled form and supporting documents.
2. The original files are sent to Gemini as inline document data so the model
   can compare the documents directly.
3. Gemini returns a structured result for every configured field, including the
   source attachment, value, status, page, and approximate bounding box.
4. The application performs deterministic numeric reconciliation to catch
   cases where visually similar numbers were incorrectly marked as matching.
5. OCR runs on the complete rendered PDF page, including PDFs that contain a
   mixture of embedded text and handwritten or image-overlay values.
6. OCR refines the value bounding box and resolves the correct PDF page.
7. The result panel shows the comparison outcome, and selecting a result opens
   the relevant document location.

## Project structure

```text
src/
├── components/
│   ├── ComparisonResult.svelte  # Comparison controls and field results
│   ├── DocumentViewer.svelte    # Image/PDF preview and highlights
│   └── Sidebar.svelte           # Upload and document selection UI
├── lib/
│   ├── compare/
│   │   └── compareFilledForm.js # Gemini prompt, parsing, and reconciliation
│   ├── gemini/
│   │   ├── client.js            # Gemini API client
│   │   └── fileUtils.js         # File and inline-data utilities
│   ├── ocr/
│   │   └── ocrUtils.js          # PDF rendering and Tesseract OCR
│   ├── pdf/
│   │   └── reportPdf.js          # Comparison report generation
│   └── store.svelte.js           # Shared application state
└── App.svelte                   # Application shell
```

## Run locally

### Requirements

- Node.js 18 or newer
- A Google Gemini API key

## Sample files

Click either link to download a ZIP archive containing the sample files to your
computer:

- [Download the JPN form samples](./sample-to-test/borang-samples.zip)
- [Download the supporting-document samples](./sample-to-test/lampiran-samples.zip)

The `borang` archive contains forms to upload as the completed form. The
`lampiran` archive contains supporting documents to upload with them. The
original folders are also available in [`sample-to-test/`](./sample-to-test/).

### Installation

```bash
npm install
```

Create a local `.env` file in the project root. Do not commit this file:

```env
VITE_GEMINI_API_KEY=your_gemini_api_key
VITE_GEMINI_MODEL=gemini-2.0-flash
```

Start the development server:

```bash
npm run dev
```

Create a production build:

```bash
npm run build
```

## Engineering highlights

- Designed the comparison response as structured JSON instead of relying on
  unstructured model output.
- Added validation and normalisation for model-generated fields and bounding
  boxes.
- Added a deterministic backstop for numeric identifiers and measurements.
- Handled asynchronous PDF rendering with generation checks so stale renders do
  not replace newer page selections.
- Supported mixed PDF content by combining rendered-page OCR with embedded PDF
  text extraction.
- Kept document comparison, OCR, file utilities, PDF reporting, and UI state
  in separate modules.

## Scope and limitations

This project is a proof of concept and is not an official JPN system. It does
not submit real applications to government services, store user documents, or
replace human review. The Gemini API key is used from the client for local
demonstration only; a production implementation should move API calls to a
secured backend, add authentication and access control, protect uploaded
documents, and implement audit logging.

OCR accuracy can vary with handwriting, image quality, document orientation,
language, and PDF rendering. The application therefore presents the detected
values and comparison evidence for user review rather than treating AI output
as an unquestionable decision.

## Portfolio context

This project demonstrates how I approach a practical software problem:
breaking it into testable modules, combining probabilistic AI output with
deterministic validation, handling real document formats, and designing an
interface that makes automated results easier to inspect.
