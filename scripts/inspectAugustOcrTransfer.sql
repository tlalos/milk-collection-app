-- Run on the PRODUCTION SQL server. No permanent tables or records are changed.
-- Assumes August 2026. Change these dates if a different year is required.
USE [milkcollection];
SET NOCOUNT ON;
DECLARE @Start date = '20260801';
DECLARE @End date = DATEADD(month, 1, @Start);

IF OBJECT_ID('tempdb..#AugustOcrJobs') IS NOT NULL DROP TABLE #AugustOcrJobs;

-- Read the same JSON document date the application uses, not the upload date.
SELECT j.id INTO #AugustOcrJobs
FROM dbo.OcrJobs AS j
CROSS APPLY (VALUES (JSON_VALUE(j.jobJson, '$.data.date'))) AS raw(documentDate)
CROSS APPLY (VALUES (COALESCE(
    TRY_CONVERT(date, raw.documentDate, 23),
    TRY_CONVERT(date, raw.documentDate, 103)
))) AS parsed(documentDate)
WHERE j.documentCategory IN ('daily_routes', 'journal_monthly_settlement')
  AND parsed.documentDate >= @Start AND parsed.documentDate < @End;

-- 1. Inventory. Pending and reviewed documents are both included.
SELECT j.documentCategory, j.status, j.reviewStatus,
       COUNT(*) AS documents,
       SUM((SELECT_COUNT.rowCount)) AS detailRows
FROM dbo.OcrJobs AS j
JOIN #AugustOcrJobs AS a ON a.id = j.id
OUTER APPLY (SELECT COUNT(*) AS rowCount FROM dbo.OcrJobRows r WHERE r.jobId = j.id) AS SELECT_COUNT
GROUP BY j.documentCategory, j.status, j.reviewStatus;

-- 2. Ambiguous August journals: inspect these before exporting.
-- A month number alone does not establish the year. Do not automatically import them.
SELECT j.id, j.sourceFile, j.createdAt, j.dataDate, j.dataMonth,
       JSON_VALUE(j.jobJson, '$.data.date') AS jsonDate,
       JSON_VALUE(j.jobJson, '$.data.documentMonth') AS jsonMonth
FROM dbo.OcrJobs AS j
WHERE j.documentCategory = 'journal_monthly_settlement'
  AND TRY_CONVERT(int, JSON_VALUE(j.jobJson, '$.data.documentMonth')) = MONTH(@Start)
  AND NOT EXISTS (SELECT 1 FROM #AugustOcrJobs a WHERE a.id = j.id);

-- 3. Parent records to transfer, INCLUDING complete jobJson.
SELECT j.* FROM dbo.OcrJobs AS j
JOIN #AugustOcrJobs AS a ON a.id = j.id
ORDER BY j.dataDate, j.id;

-- 4. Matching detail records. Do not preserve rowId when inserting locally:
-- it is a local identity. Preserve jobId and rowNumber.
SELECT r.jobId, r.documentCategory, r.rowNumber, r.centerName, r.producerName,
       r.milkType, r.liters, r.fatPercent, r.density, r.water, r.temperature,
       r.noticeNumber, r.confidence, r.rowJson
FROM dbo.OcrJobRows AS r
JOIN #AugustOcrJobs AS a ON a.id = r.jobId
ORDER BY r.jobId, r.rowNumber;

-- 5. Source-file manifest. Files are not stored inside these SQL tables.
SELECT j.id, j.sourceFile, j.storedFilename,
       JSON_VALUE(j.jobJson, '$.archiveStatus.status') AS archiveStatus
FROM dbo.OcrJobs AS j
JOIN #AugustOcrJobs AS a ON a.id = j.id
ORDER BY j.id;
