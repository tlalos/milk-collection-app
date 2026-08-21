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

After a document is saved and marked reviewed, its collection rows are queued for background append to Excel Online table `Daily_Routes` / `tblDailyRoutes`. Configure Microsoft Graph in this project's `.env` with `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `GRAPH_WORKBOOK_URL` or `GRAPH_DRIVE_ID`/`GRAPH_ITEM_ID`, and `EXCEL_GRAPH_TOKEN_CACHE`. Run `npm run graph:login` to create or refresh the delegated token cache. `OCR_EXCEL_DEFAULT_MILK_CODE` defaults to `MILK-COW` and `OCR_EXCEL_ANTIBIOTICS_STATUS` defaults to `OK`.

OCR collection-center names are compared with `Ref_Centers` / `tblCenters` after extraction. A match of 60% or higher automatically replaces the OCR description with the reference description and is visibly marked as system-replaced. Lower matches remain optional suggestions; `Center_Code` is not mandatory and the workbook keeps responsibility for its normal code lookup.

For frontend development, run `npm run server` and `npm run dev` in separate terminals. Vite proxies `/api/ocr` to the local backend.

## OCR configuration

- `OPENAI_API_KEY`: required server-side API key.
- `OPENAI_OCR_MODEL`: optional model override; defaults to `gpt-5.6-terra`.
- `LOCAL_OCR_URL`: optional URL for the experimental self-hosted PaddleOCR sidecar (normally `http://127.0.0.1:8790`). Install and start it using `local-ocr/README.md`, then select **Local Open Source** in OCR Settings. OpenAI remains the default and can be selected again at any time.
- `PORT`: optional server port; defaults to `8787`.

Extracted values must be reviewed before import into another system. Illegible values are returned as `null`, with warnings and uncertain-field markers in the structured JSON.
