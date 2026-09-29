-- Run each numbered query separately in the production milkcollection database.
-- Save each result as the named Excel workbook. These queries only read data.
-- JSON is split into 30,000-character parts to stay below Excel's cell limit.
-- Keep ALL rows and columns, including PartNumber. Do not deduplicate the output.

-- QUERY 1: save as August2026_OcrJobs.xlsx
;WITH Selected AS (
    SELECT j.*
    FROM dbo.OcrJobs j
    CROSS APPLY (VALUES (JSON_VALUE(j.jobJson, '$.data.date'))) d(DocumentDate)
    CROSS APPLY (VALUES (COALESCE(TRY_CONVERT(date, d.DocumentDate, 23),
                                TRY_CONVERT(date, d.DocumentDate, 103)))) p(DocumentDate)
    WHERE j.documentCategory IN ('daily_routes', 'journal_monthly_settlement')
      AND p.DocumentDate >= CONVERT(date, '20260801', 112)
      AND p.DocumentDate < CONVERT(date, '20260901', 112)
), Parts AS (
    SELECT TOP (SELECT COALESCE(MAX((LEN(jobJson) + 29999) / 30000), 0) FROM Selected)
           ROW_NUMBER() OVER (ORDER BY a.object_id, b.object_id) AS PartNumber
    FROM sys.all_objects a CROSS JOIN sys.all_objects b
    ORDER BY a.object_id, b.object_id
)
SELECT j.id, j.sourceFile, j.storedFilename, j.mimeType, j.size,
       j.documentCategory, j.status, j.reviewStatus,
       CONVERT(nvarchar(40), j.createdAt, 127) AS createdAt,
       CONVERT(nvarchar(40), j.updatedAt, 127) AS updatedAt,
       CONVERT(nvarchar(40), j.startedAt, 127) AS startedAt,
       CONVERT(nvarchar(40), j.completedAt, 127) AS completedAt,
       CONVERT(nvarchar(40), j.reviewedAt, 127) AS reviewedAt,
       CONVERT(nvarchar(10), j.dataDate, 23) AS dataDate,
       j.dataMonth, j.route, j.driverName, j.vehicleRegistration,
       j.headerCenterName, j.totalLiters,
       p.PartNumber, (LEN(j.jobJson) + 29999) / 30000 AS TotalParts,
       LEN(j.jobJson) AS JsonCharacters,
       SUBSTRING(j.jobJson, (p.PartNumber - 1) * 30000 + 1, 30000) AS jobJsonPart
FROM Selected j
JOIN Parts p ON p.PartNumber <= (LEN(j.jobJson) + 29999) / 30000
ORDER BY j.id, p.PartNumber
OPTION (MAXRECURSION 0);

-- QUERY 2: save as August2026_OcrJobRows.xlsx
;WITH Selected AS (
    SELECT r.*
    FROM dbo.OcrJobRows r
    JOIN dbo.OcrJobs j ON j.id = r.jobId
    CROSS APPLY (VALUES (JSON_VALUE(j.jobJson, '$.data.date'))) d(DocumentDate)
    CROSS APPLY (VALUES (COALESCE(TRY_CONVERT(date, d.DocumentDate, 23),
                                TRY_CONVERT(date, d.DocumentDate, 103)))) p(DocumentDate)
    WHERE j.documentCategory IN ('daily_routes', 'journal_monthly_settlement')
      AND p.DocumentDate >= CONVERT(date, '20260801', 112)
      AND p.DocumentDate < CONVERT(date, '20260901', 112)
), Parts AS (
    SELECT TOP (SELECT COALESCE(MAX((LEN(rowJson) + 29999) / 30000), 0) FROM Selected)
           ROW_NUMBER() OVER (ORDER BY a.object_id, b.object_id) AS PartNumber
    FROM sys.all_objects a CROSS JOIN sys.all_objects b
    ORDER BY a.object_id, b.object_id
)
SELECT r.rowId AS sourceRowId, r.jobId, r.documentCategory, r.rowNumber,
       r.centerName, r.producerName, r.milkType, r.liters, r.fatPercent,
       r.density, r.water, r.temperature, r.noticeNumber, r.confidence,
       p.PartNumber, (LEN(r.rowJson) + 29999) / 30000 AS TotalParts,
       LEN(r.rowJson) AS JsonCharacters,
       SUBSTRING(r.rowJson, (p.PartNumber - 1) * 30000 + 1, 30000) AS rowJsonPart
FROM Selected r
JOIN Parts p ON p.PartNumber <= (LEN(r.rowJson) + 29999) / 30000
ORDER BY r.jobId, r.rowId, p.PartNumber
OPTION (MAXRECURSION 0);

-- QUERY 3: save as OcrErpReferenceSnapshot.xlsx
-- This is the current supplier snapshot, not a historical August snapshot.
;WITH JsonFields AS (
    SELECT s.snapshotKey, s.fetchedAt, f.JsonField, f.JsonText
    FROM dbo.OcrErpReferenceSnapshot s
    CROSS APPLY (VALUES ('centersJson', s.centersJson),
                        ('producersJson', s.producersJson)) f(JsonField, JsonText)
    WHERE s.snapshotKey = 'suppliers'
), Parts AS (
    SELECT TOP (SELECT COALESCE(MAX((LEN(JsonText) + 29999) / 30000), 0) FROM JsonFields)
           ROW_NUMBER() OVER (ORDER BY a.object_id, b.object_id) AS PartNumber
    FROM sys.all_objects a CROSS JOIN sys.all_objects b
    ORDER BY a.object_id, b.object_id
)
SELECT f.snapshotKey, CONVERT(nvarchar(40), f.fetchedAt, 127) AS fetchedAt,
       f.JsonField, p.PartNumber, (LEN(f.JsonText) + 29999) / 30000 AS TotalParts,
       LEN(f.JsonText) AS JsonCharacters,
       SUBSTRING(f.JsonText, (p.PartNumber - 1) * 30000 + 1, 30000) AS JsonPart
FROM JsonFields f
JOIN Parts p ON p.PartNumber <= (LEN(f.JsonText) + 29999) / 30000
ORDER BY f.snapshotKey, f.JsonField, p.PartNumber
OPTION (MAXRECURSION 0);
