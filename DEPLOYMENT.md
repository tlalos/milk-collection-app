# Production deployment

## Requirements

- Node.js 20 or newer
- A persistent writable directory for `data/ocr`
- A Microsoft Graph delegated refresh-token cache stored outside the release directory
- HTTPS reverse proxy for public use

## Install and start

1. Extract the distribution ZIP into a release directory.
2. Copy `.env.example` to `.env` and provide the production values.
3. Run `npm ci --omit=dev`.
4. Start with `npm start` using a process manager such as IIS/iisnode, PM2, NSSM, or systemd.
5. Reverse proxy the public site to the configured `PORT`.

The frontend is already compiled in `dist`; no production build is required on the server.

## Persistent data

The current filesystem store uses `data/ocr/files` for uploaded documents and `data/ocr/jobs` for job metadata. The release package does not include either directory. Configure the deployment so `data/ocr` survives application upgrades and is backed up. If releases are replaced atomically, mount or link a persistent data directory at `data/ocr`.

Optional cleanup can move old reviewed source documents from `data/ocr/files` to SharePoint. Enable it with `OCR_ARCHIVE_ENABLED=true`. By default it archives Daily Routes and Monthly Settlement documents that are completed, reviewed, and at least 60 days old. It uploads Daily Routes to `OCR_ARCHIVE_DAILY_FOLDER_PATH` and Monthly Settlement journals to `OCR_ARCHIVE_MONTHLY_FOLDER_PATH`; the defaults are `pictures/daily` and `pictures/journals`. Monthly settlement files are renamed with the header center and timestamp; Daily Routes files are renamed with the timestamp and truck number. The local source file is deleted only after the SharePoint upload succeeds; the job JSON remains and records `archiveStatus`. A backup history is also kept locally at `data/ocr/archive-history.json` and mirrored to SharePoint at `OCR_ARCHIVE_HISTORY_FILE_PATH`.

## Required environment values

- `OPENAI_API_KEY`
- `OPENAI_OCR_MODEL` (defaults to `gpt-5.6-terra`)
- `PORT`
- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `GRAPH_WORKBOOK_URL`, or both `GRAPH_DRIVE_ID` and `GRAPH_ITEM_ID`
- `EXCEL_GRAPH_TOKEN_CACHE`: absolute path to the delegated Graph token-cache JSON

Optional OCR archive cleanup values:

- `OCR_ARCHIVE_ENABLED`: set to `true` to enable automatic SharePoint archiving
- `OCR_ARCHIVE_SHAREPOINT_FOLDER_PATH`: root destination folder path in the SharePoint drive; defaults to `pictures`
- `OCR_ARCHIVE_DAILY_FOLDER_PATH`: destination folder for Daily Routes images; defaults to `pictures/daily`
- `OCR_ARCHIVE_MONTHLY_FOLDER_PATH`: destination folder for Monthly Settlement journal images; defaults to `pictures/journals`
- `OCR_ARCHIVE_HISTORY_FILE_PATH`: SharePoint path for the archive history backup JSON; defaults to `pictures/archive-history.json`
- `OCR_ARCHIVE_DRIVE_ID`: optional destination drive id; leave blank to use the workbook drive
- `OCR_ARCHIVE_MIN_AGE_DAYS`: defaults to `60`
- `OCR_ARCHIVE_INTERVAL_HOURS`: defaults to `24`
- `OCR_ARCHIVE_INITIAL_DELAY_MINUTES`: defaults to `5`

The token-cache file must be writable by the application identity because refresh tokens are rotated. Do not place `.env` or the token cache inside source control or a replaceable release directory.

## URLs and health check

- `/ocr/upload`
- `/ocr/review`
- `/api/ocr/health`

Protect `/ocr/review` and the review APIs with production authentication before exposing the application publicly.

## IIS with HttpPlatformHandler

The distribution includes `web.config` for the same IIS HttpPlatformHandler hosting model used by the Excel integration service.

1. Install Node.js 20+ and enable IIS HttpPlatformHandler.
2. Extract the ZIP into a permanent IIS application directory.
3. Run `npm ci --omit=dev` in that directory as an administrator/deployment account.
4. Copy `.env.example` to `.env` and configure the production secrets and workbook settings. IIS supplies the runtime `PORT`; the `.env` port is ignored under HttpPlatformHandler.
5. In IIS Manager, create a website or application pointing to the extracted directory.
6. Use an application pool with **No Managed Code** and **Integrated** pipeline mode.
7. Grant the application-pool identity **Read & Execute** on the application directory and Node.js, and **Modify** on `data\ocr`, `logs`, and the external Graph token-cache file.
8. Start the website and open `/api/ocr/health`.

The included IIS request limit is 160 MB, allowing the backend's batch upload limit of ten files up to 15 MB each. This IIS distribution is built for the `/milk` application path, so it can share the existing port and website. Its public routes are `/milk/ocr/upload`, `/milk/ocr/review`, and `/milk/api/ocr/health`.

Example permissions, replacing `MilkCollectionPool` and the paths as needed:

```powershell
icacls "C:\inetpub\milk-collection\data\ocr" /grant "IIS AppPool\MilkCollectionPool:(OI)(CI)M"
icacls "C:\inetpub\milk-collection\logs" /grant "IIS AppPool\MilkCollectionPool:(OI)(CI)M"
icacls "C:\ProgramData\MilkCollection\graph-token-cache.json" /grant "IIS AppPool\MilkCollectionPool:M"
```
