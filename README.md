# Milk Collection App

## Local setup

1. Install dependencies with `npm ci`.
2. Copy `.env.example` to `.env`.
3. Set `OPENAI_API_KEY` in `.env`. Keep this key on the server; never add it to a `VITE_` variable.
4. Build the frontend with `npm run build`.
5. Start the production app and OCR API with `npm start`.
6. Open the mobile uploader at `http://127.0.0.1:8787/ocr/upload` or the back-office review queue at `http://127.0.0.1:8787/ocr/review`.

The asynchronous upload endpoint accepts up to 10 JPG, PNG, WEBP, or PDF documents at `POST /api/ocr/jobs`. Each file may be up to 15 MB. Uploaded files and job metadata are persisted under `data/ocr/`, which is excluded from Git. The endpoint returns immediately with `202 Accepted`; OCR continues in a server-side queue and unfinished jobs resume after a server restart.

Newly processed documents also persist OpenAI token usage and an estimated USD cost. The estimate uses the dated per-model pricing snapshot in `server/openaiCost.js`; documents processed before cost tracking show that no cost was recorded.

Back-office APIs list pending jobs, return job details and source files, and mark completed jobs as reviewed. Protect `/ocr/review` and its APIs with your production authentication layer before exposing the service outside a trusted network.

`POST /api/ocr/jobs/:id/reprocess` requeues a stored source document, clears its previous recognised data and accounting, and saves a fresh OCR result and cost when background processing completes.

OCR export to Excel is retired. Microsoft Graph settings are still used by the remaining previous-day quality lookup and SharePoint archiving.

Use **Fetch ERP list** on the OCR page before processing documents. It saves a shared server-side snapshot of `C*` centers and `P*` producers, including their center relationships; in SQL mode this is `dbo.OcrErpReferenceSnapshot`. Automatic OCR matching, review lists, reconciliation center corrections, and OCR issue checks use this ERP snapshot, not the Excel center or producer sheets. A center match of 60% or higher automatically replaces the OCR description; lower matches remain suggestions. If no ERP list has been saved, OCR extraction can still finish but reference matching reports an error. A failed refresh does not replace the last saved list.

Set `OCR_ARCHIVE_ENABLED=true` to run the automatic OCR source-file cleanup. The cleanup archives reviewed Daily Routes and Monthly Settlement source documents that were completed at least `OCR_ARCHIVE_MIN_AGE_DAYS` days ago, uploads Daily Routes to `OCR_ARCHIVE_DAILY_FOLDER_PATH` and Monthly Settlement journals to `OCR_ARCHIVE_MONTHLY_FOLDER_PATH` using Microsoft Graph, and removes the local file only after SharePoint confirms the upload. Monthly settlement files are named with the header center and timestamp; Daily Routes files are named with the timestamp and truck number. Job JSON files stay in `data/ocr/jobs` with an `archiveStatus` record. A separate local backup file is kept at `data/ocr/archive-history.json` and mirrored to `OCR_ARCHIVE_HISTORY_FILE_PATH` in SharePoint.

For frontend development, run `npm run server` and `npm run dev` in separate terminals. Vite proxies `/api/ocr` to the local backend.

## OCR configuration

- `OPENAI_API_KEY`: required server-side API key.
- `OPENAI_OCR_MODEL`: optional model override; defaults to `gpt-5.6-terra`.
- `PORT`: optional server port; defaults to `8787`.

Extracted values must be reviewed before import into another system. Illegible values are returned as `null`, with warnings and uncertain-field markers in the structured JSON.

## Dependency-update verification checklist

This checklist tracks the current security maintenance work. Local automated tests do not replace the manual checks below. Production has not been updated by this work.

### Fix progress

- [x] Multer 2.4.0: upload types, file-count/size limits, malformed requests and OCR permissions tested locally.
- [x] Sharp 0.35.5: sample-document crops, orientation, resizing and damaged images tested locally on Windows.
- [x] Undici 7.29.1: request payloads, authorization, responses, timeouts, disconnects and error handling tested against a local mock provider. No live OCR-provider calls were made.
- [ ] qs: update and verify API request handling.
- [ ] brace-expansion: update and verify Excel exports.
- [ ] Rerun the production dependency audit and build after all updates; record any remaining warnings.

Checkpoint after Undici (2026-10-06): 29 focused tests passed; the app build passed with the existing large-bundle warning. The production audit reports only qs (moderate) and brace-expansion (high). Multer, Sharp and Undici findings are cleared locally.

Later checkpoint (2026-10-06): Express's proxy-addr dependency is pinned to 2.0.8.
The address-spoofing regression reproduced on 2.0.7 and passes on 2.0.8; 33 focused
tests pass. A fresh production audit now reports zero critical findings, one high
(brace-expansion), and four moderate (qs and the sprintf-js/tedious/mssql chain).
These remaining findings are not fixed by the proxy-addr patch. Apply the new
package.json and package-lock.json together on the stopped server and run
`npm ci --omit=dev`; the earlier distribution ZIP alone does not contain this fix.

### User checks after all fixes

- [ ] In a test environment, upload a daily route image and a monthly settlement image; confirm processing finishes and review still opens.
- [ ] Test a detailed monthly journal with the final totals on the right; compare the last rows and totals with the source image.
- [ ] Test one PDF with a configured provider that supports PDFs, and a batch of images. Confirm every expected document appears once.
- [ ] For each OCR provider actually used, run one known test document. Confirm recognition finishes with no new connection errors. Keep test documents out of ERP sending.
- [ ] After the qs update, check login and month/center/producer filters on reconciliation, invoices and bank note pages.
- [ ] After the export dependency update, use test payment data to check the XLSX columns, recipient/connected-account details, amounts, Romanian comments, numbering and the 99-payment-per-file split. Confirm exported rows become Exported and cannot be reset to Pending. Export changes status, so do not use real pending payments merely for testing.
- [ ] Check invoice dates and existing Sent/locked statuses still display correctly. These dependency changes do not require resending existing Aviz, NIR or invoices; any optional send test must use a new controlled test document.

### Deployment checks

- [ ] Confirm the Node executable used by IIS is compatible with the dependency engines. Sharp requires Node >=20.9.0 and Undici requires >=20.18.1; also check the other installed dependencies. Local verification used Node 24.15.0 on Windows.
- [ ] Back up the deployment and preserve `.env` and application data. Use the newly generated distribution only after the remaining fixes and tests are complete.
- [ ] Stop the app pool before installing dependencies, check that installation succeeds, and restart the pool so the updated native libraries and HTTP client are loaded.
- [ ] On the server, verify Sharp loads with `node -e "console.log(require('sharp').versions)"`, then check login, one controlled OCR upload and server logs. Never run a forced audit fix directly on production.
