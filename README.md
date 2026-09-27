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
