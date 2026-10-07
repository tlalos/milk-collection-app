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

## Local production-data copies

Before replacing a local database, create and verify a full local rollback backup.
Restore the production copy only onto the explicitly checked local SQL instance,
preserving local connection settings. Clear copied `AppSessions`, not users or roles.
Source images/PDFs in `data/ocr/files` are separate from SQL backups.

Set `LOCAL_PRODUCTION_CLONE=true` in the local `.env` while inspecting the copy,
then restart both the API and Vite. This mode binds the API to loopback, blocks
API mutations except sign-in/sign-out, blocks outbound server HTTP, and skips OCR
resumption, automatic archiving, reconciliation rebuilding and seed-account changes.
Vite and the API also send a connect-src policy to prevent browser ERP requests.
Existing users, password hashes and permissions are retained; normal schema
initialization still runs. This mode is for read-only inspection, not end-to-end
ERP or OCR processing tests. Never copy the local `.env` to production.

## Build the IIS package

Use the package script when preparing the IIS/server ZIP:

```powershell
npm run package:iis
```

This builds the frontend with `VITE_BASE_PATH=/milk/` before zipping the release. That is important because the IIS deployment runs under `/milk`; a build made for `/` will load `/assets/...` instead of `/milk/assets/...` and can show a blank page.

## Move Milk Deliveries data to production

The application ZIP contains the table schema and `scripts/transferMilkDeliveries.mjs`, but not local SQL data. Export the local `dbo.MilkDeliveries` table separately:

```powershell
node .\scripts\transferMilkDeliveries.mjs export
```

Keep the generated data package private. Copy it to the production server and extract it **outside** `C:\inetpub\wwwroot\milk`. Deploy the application ZIP and restart the IIS app first, so `dbo.MilkDeliveries` and its current columns exist. Then, from the production application directory, run a dry-run using the actual snapshot path:

```powershell
cd C:\inetpub\wwwroot\milk
node .\scripts\transferMilkDeliveries.mjs import "C:\temp\milk-deliveries-data\milk-deliveries.json"
```

Check that the printed target server and database are the intended production database and that `conflicts` is empty. Only then apply the import:

```powershell
node .\scripts\transferMilkDeliveries.mjs import "C:\temp\milk-deliveries-data\milk-deliveries.json" --apply
```

The importer inserts missing deliveries in one transaction. It skips identical IDs, refuses conflicting IDs or duplicate deliveries, and never updates or deletes existing production rows. Run the dry-run again afterward; `wouldInsert` should be `0`. This transfers the delivery records, not the local activity log.

The Milk Deliveries API also creates `dbo.MilkDeliveryWeightEvents` and adds nullable weight-source fields to `dbo.MilkDeliveries`. New manual and scale changes are logged with the user and save time. Existing rows are not backfilled with a guessed source or event history.

## Producer Contracts for APIA

`dbo.ProducerContracts` stores contract numbers, dates and total contracted kilograms
independently of SoftOne reference synchronization. Startup creates the table but
does not import local data. The APIA list joins contracts by producer code and milk
type, requiring one contract covering the complete reporting month. Missing,
partial or ambiguous contracts remain visible with blank contract fields and a warning.
Dates are inclusive. Renewals are separate records; the importer refuses overlaps
instead of overwriting earlier contract history.

The `elgo` importer reads the workbook's **saved values**, including cached formula
results, from F-I, linked by column V. It does not recalculate contract information.
This workbook layout is for cow milk. Keep the source workbook outside the web root.
Run a read-only preview first:

```powershell
node .\scripts\importProducerContracts.mjs "C:\temp\contracts.xlsx"
```

The preview validates every code against the saved ERP supplier snapshot and prints
the database target, source SHA-256, insertion count and conflicts. After verifying
the target and ensuring there are no conflicts, append
`--apply --confirm-target "SERVER/DATABASE"` using the exact target printed.
The import is transactional, insert-only and idempotent: unchanged records are
skipped, and conflicts prevent all record changes. No pricing, invoices or ERP data
are changed. Application ZIPs contain the importer, not the private contract data.

To transfer the actual saved SQL contracts (rather than re-reading the workbook), run
`node scripts/transferProducerContracts.mjs export work/contract-transfer` locally.
Keep `producer-contracts.json` outside the production website directory. After
deploying the application, preview on the server with
`node scripts/transferProducerContracts.mjs import "C:\temp\producer-contracts.json"`.
Append `--apply --confirm-target "SERVER/DATABASE"` only after checking the printed
target and conflicts. Snapshot checksums are verified, original workbook provenance
is retained, and the same transactional, insert-only protections apply.

## Monthly Invoice Sending

Save the ERP base URL once in the app's OCR connection settings. Aviz/NIR, supplier refresh and monthly invoices all resolve this shared URL from `data/settings/erp-connection.json`. Changing the URL requires the `ocr_settings` permission; users can save their own browser credentials without changing the shared URL. Preserve `data/settings` during upgrades. Credentials stay in the browser and are supplied for invoice preview/send, never saved in invoice history. Use HTTPS for production access.

For existing installations, `MONTHLY_INVOICE_ERP_URL` is only a compatibility fallback until the connection settings are saved once. The saved shared URL takes precedence; the old environment entry can then be removed. New installations do not need this environment variable. Invoice requests reject a destination that differs from the saved configuration, and ERP redirects are refused.

The row button opens a server-generated preview. Confirming revalidates saved pricing, producer references and invoice date, then claims the invoice in SQL before making one ERP request. Sent, in-flight and unconfirmed invoices cannot be submitted again. Unconfirmed results require ERP investigation; automatic retry and manual recovery are not enabled. SQL tables are created on backend startup. No invoice is sent by deployment or startup.

If the ERP API is on the app server but its public address is unreachable from that
server, verify the local API first, then set
`MONTHLY_INVOICE_ERP_INTERNAL_URL=http://127.0.0.1:8102/wmsapi/api` in the server's
`.env` and restart the app pool. This optional override routes only monthly invoice
login, lookup, preview and send requests internally. It does not change the shared
public ERP URL used by browsers or other workflows. Browser requests must still
match the approved shared URL; clients cannot supply the internal override.
There is no automatic retry or fallback between addresses. Keep the override unset
unless its target is the same trusted ERP installation as the shared public URL.

## Persistent data

The current filesystem store uses `data/ocr/files` for uploaded documents and `data/ocr/jobs` for job metadata. The release package does not include either directory. Configure the deployment so `data/ocr` survives application upgrades and is backed up. If releases are replaced atomically, mount or link a persistent data directory at `data/ocr`.

Optional cleanup can move old reviewed source documents from `data/ocr/files` to SharePoint. Enable it with `OCR_ARCHIVE_ENABLED=true`. By default it archives Daily Routes and Monthly Settlement documents that are completed, reviewed, and at least 60 days old. It uploads Daily Routes to `OCR_ARCHIVE_DAILY_FOLDER_PATH` and Monthly Settlement journals to `OCR_ARCHIVE_MONTHLY_FOLDER_PATH`; the defaults are `pictures/daily` and `pictures/journals`. Monthly settlement files are renamed with the header center and timestamp; Daily Routes files are renamed with the timestamp and truck number. The local source file is deleted only after the SharePoint upload succeeds; the job JSON remains and records `archiveStatus`. A backup history is also kept locally at `data/ocr/archive-history.json` and mirrored to SharePoint at `OCR_ARCHIVE_HISTORY_FILE_PATH`.

## SQL Server storage

OCR job metadata and rows can be stored in Microsoft SQL Server instead of JSON files. The Milk Reception screen also uses SQL Server and creates `dbo.MilkReceptions` automatically the first time the reception API is used. Uploaded OCR source images/PDF files still stay in `data/ocr/files` until they are archived to SharePoint.

Set these values in the server `.env`:

```powershell
OCR_JOB_STORE=sql
SQL_SERVER=localhost
SQL_DATABASE=milkcollection
SQL_USER=sa
SQL_PASSWORD=your-password
SQL_ENCRYPT=false
SQL_TRUST_SERVER_CERTIFICATE=true
```

Before switching production to SQL, copy the current server JSON OCR jobs into SQL once:

```powershell
cd C:\inetpub\wwwroot\milk
npm ci --omit=dev
node .\scripts\migrateOcrJobsToSql.mjs
```

The migration reads `data\ocr\jobs\*.json`, creates or updates `dbo.OcrJobs` and `dbo.OcrJobRows`, and does not delete the JSON files. Keep the JSON files as a backup until the SQL-backed app has been verified. `dbo.MilkReceptions` has no JSON migration because new reception records are entered directly in the app.

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

## Page access rollout

Web Users now exposes independent grants for Backup History (`backup_history`)
and Exports (`exports`). Bank Note inherits `month_closure`; Milk Factors inherits
the shared Reception and Deliveries grant (`milk_reception`).
The Exports grant covers its menu and all reports, including APIA and Veterinary. User Log History uses
`audit_log`, not `app_admin`. Administrators retain access; existing non-admin
roles are not automatically granted these new permissions. Review roles in
`/web-users` after deploying the server and frontend together.

`milk_collection` gates the entire master-menu Milk Collection area, including
Customers, Data Sync, Journal, Transport, settings, and the collection login.
The old individual Customers/Data Sync/Journal/Transport permission choices are
no longer used. The collection area now requires an authenticated Web session
in addition to its existing collection-user login where applicable; opening it
after a reload requires connectivity to the app server. Reception and Deliveries
continue to share `milk_reception`.

APIA data is loaded through `/api/ocr/exports/apia-rows` using `exports`;
OCR or Monthly Reconciliation access is not required. Read access to supporting
data does not grant permission to edit documents, change prices, or send invoices.
All supplier-reference routes now require an authenticated, authorized Web user.
Saved supplier data can be read by its consuming pages; refreshing it requires
`ocr_documents`.

## Veterinary animal counts

`dbo.ProducerHerdCounts` is separate from contracts and keyed by producer code
and effective month. Formular 1 uses the latest snapshot on or before the selected
month; earlier reports do not inherit later counts. Unknown species counts remain
NULL. Counts do not change which producers qualify for the month's report.
Source workbook, sheet, row numbers, SHA-256, import timestamp and actor are stored.
The table is created at startup; deploying application files does not import data.

`scripts/importVeterinaryHerdCounts.mjs <workbook.xlsx> --effective-month 2026-08`
previews the approved workbook using the saved ERP producer list. Add `--apply
--confirm-target "SERVER/DATABASE"` with the exact preview target to apply. The
workbook hash and approved matching/exclusion rules are enforced. Import uses a
transaction, verifies all rows before commit, and refuses conflicting counts for
an existing month. An identical repeat is a no-op. Review changed workbooks and
matching rules before future imports; do not reuse the initial exclusions blindly.

The first approved import contains 247 producer records and 397 cows, effective
August 2026. Buffalo and sheep/goat counts are unknown, not zero. The local import
does not disable the production-clone network or read-only HTTP guards.

The Veterinary header's Animal counts button opens
`/ocr/exports/veterinary/animal-counts`. The selected month determines both the
producer list (journals and approved aviz) and the effective month for edits.
Missing counts are shown by default; producers need a saved ERP code to be edited.
Users with the existing `exports` permission can save. New months create snapshots;
corrections within the same month update that snapshot. Earlier months remain
unchanged. Each save records before/after values and the signed-in user in
`AppAuditLog` atomically. SQL row versions prevent stale overwrites, including
changes to a count inherited from an earlier month.

Local production clones still block saves by default. After explicit approval,
`LOCAL_PRODUCTION_CLONE_HERD_EDITS=true` allows only the animal-count PUT endpoint
when SQL_SERVER is loopback. All other business writes and outbound HTTP remain
blocked. The UI shows a read-only notice when this exception is not enabled.

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
