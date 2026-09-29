-- READ-ONLY against production tables. Only temporary tables are written.
-- Run the entire script in SSMS. Save the single result WITH COLUMN HEADERS.
-- Keep every row/column and all parts. Do not deduplicate or edit JsonPart.
-- Each source record is JSON split into <= 30000 characters for Excel.
-- User accounts, sessions, credentials, app settings and security audit are excluded.
USE [milkcollection];
SET NOCOUNT ON;

DECLARE @Start date = '20260801';
DECLARE @EndExclusive date = '20260930'; -- Includes 29 September 2026.

DROP TABLE IF EXISTS #ExportJobs;
SELECT j.id INTO #ExportJobs
FROM dbo.OcrJobs j
WHERE COALESCE(
    TRY_CONVERT(date, JSON_VALUE(j.jobJson, '$.data.date'), 23),
    TRY_CONVERT(date, JSON_VALUE(j.jobJson, '$.data.date'), 103),
    j.dataDate
) >= @Start
AND COALESCE(
    TRY_CONVERT(date, JSON_VALUE(j.jobJson, '$.data.date'), 23),
    TRY_CONVERT(date, JSON_VALUE(j.jobJson, '$.data.date'), 103),
    j.dataDate
) < @EndExclusive;

-- Documents lacking a usable date cannot reliably be assigned to the range.
DECLARE @Undated int = (SELECT COUNT(*) FROM dbo.OcrJobs j WHERE COALESCE(
    TRY_CONVERT(date, JSON_VALUE(j.jobJson, '$.data.date'), 23),
    TRY_CONVERT(date, JSON_VALUE(j.jobJson, '$.data.date'), 103), j.dataDate) IS NULL);
PRINT CONCAT('OCR documents without a usable date (excluded): ', @Undated);

DROP TABLE IF EXISTS #ExportSources;
CREATE TABLE #ExportSources (TableName sysname PRIMARY KEY, Predicate nvarchar(max));
INSERT #ExportSources VALUES
('OcrJobs', N't.id IN (SELECT id FROM #ExportJobs)'),
('OcrJobRows', N't.jobId IN (SELECT id FROM #ExportJobs)'),
('MilkReceptions', N't.receptionDate >= @Start AND t.receptionDate < @End'),
('MilkReceptionQualityDetails', N'EXISTS (SELECT 1 FROM dbo.MilkReceptions r WHERE r.receptionId=t.receptionId AND r.receptionDate >= @Start AND r.receptionDate < @End)'),
('MilkReceptionWeightEvents', N'(t.recordedAt >= @Start AND t.recordedAt < @End) OR EXISTS (SELECT 1 FROM dbo.MilkReceptions r WHERE r.receptionId=t.receptionId AND r.receptionDate >= @Start AND r.receptionDate < @End)'),
('MilkDeliveries', N't.deliveryDate >= @Start AND t.deliveryDate < @End'),
('MilkDeliveryWeightEvents', N'(t.recordedAt >= @Start AND t.recordedAt < @End) OR EXISTS (SELECT 1 FROM dbo.MilkDeliveries d WHERE d.deliveryId=t.deliveryId AND d.deliveryDate >= @Start AND d.deliveryDate < @End)'),
('MilkReceptionAvizLinks', N't.jobId IN (SELECT id FROM #ExportJobs) AND EXISTS (SELECT 1 FROM dbo.MilkReceptions r WHERE r.receptionId=t.receptionId AND r.receptionDate >= @Start AND r.receptionDate < @End)'),
('MonthlyProducerPricing', N't.monthKey >= CONVERT(char(7), @Start, 126) AND t.monthKey <= CONVERT(char(7), DATEADD(day,-1,@End),126)'),
('MonthlyAvizPricingApprovals', N't.monthKey >= CONVERT(char(7), @Start, 126) AND t.monthKey <= CONVERT(char(7), DATEADD(day,-1,@End),126)'),
('MonthlyAvizPricingApprovalLines', N'EXISTS (SELECT 1 FROM dbo.MonthlyAvizPricingApprovals a WHERE a.approvalId=t.approvalId AND a.monthKey >= CONVERT(char(7), @Start,126) AND a.monthKey <= CONVERT(char(7), DATEADD(day,-1,@End),126))'),
-- Current reference data, not historical versions. Contains no API credentials.
('OcrErpReferenceSnapshot', N't.snapshotKey = N''suppliers''');

DROP TABLE IF EXISTS #ExportRecords;
CREATE TABLE #ExportRecords (
    RecordNumber bigint IDENTITY(1,1) PRIMARY KEY,
    TableName sysname NOT NULL,
    RecordJson nvarchar(max) NOT NULL
);
DROP TABLE IF EXISTS #ExportManifest;
CREATE TABLE #ExportManifest (TableName sysname, ExportStatus varchar(20), RecordCount bigint);

DECLARE @Table sysname, @Predicate nvarchar(max), @Sql nvarchar(max), @Count bigint;
DECLARE sources CURSOR LOCAL FAST_FORWARD FOR SELECT TableName, Predicate FROM #ExportSources ORDER BY TableName;
OPEN sources;
FETCH NEXT FROM sources INTO @Table, @Predicate;
WHILE @@FETCH_STATUS = 0
BEGIN
    IF OBJECT_ID(N'dbo.' + @Table, N'U') IS NULL
        INSERT #ExportManifest VALUES (@Table, 'TABLE_MISSING', 0);
    ELSE
    BEGIN
        SET @Sql = N'INSERT #ExportRecords(TableName,RecordJson)
            SELECT @Name, (SELECT t.* FOR JSON PATH, INCLUDE_NULL_VALUES, WITHOUT_ARRAY_WRAPPER)
            FROM dbo.' + QUOTENAME(@Table) + N' t WHERE ' + @Predicate + N';';
        EXEC sys.sp_executesql @Sql,
            N'@Start date, @End date, @Name sysname', @Start, @EndExclusive, @Table;
        SELECT @Count=COUNT_BIG(*) FROM #ExportRecords WHERE TableName=@Table;
        INSERT #ExportManifest VALUES (@Table, 'EXPORTED', @Count);
    END;
    FETCH NEXT FROM sources INTO @Table, @Predicate;
END;
CLOSE sources;
DEALLOCATE sources;

-- Single result set: manifest records plus data parts. The manifest distinguishes
-- empty tables from tables not yet deployed on production.
;WITH Numbers AS (
    SELECT TOP (SELECT COALESCE(MAX((DATALENGTH(RecordJson)/2 + 29999)/30000), 1) FROM #ExportRecords)
        ROW_NUMBER() OVER (ORDER BY a.object_id, b.object_id) AS PartNumber
    FROM sys.all_objects a CROSS JOIN sys.all_objects b
), Output AS (
    SELECT 'MANIFEST' AS RowType, m.TableName, CAST(0 AS bigint) AS RecordNumber,
        CAST(0 AS bigint) AS PartNumber, CAST(0 AS bigint) AS TotalParts,
        CAST(0 AS bigint) AS JsonCharacters, m.RecordCount, m.ExportStatus,
        CAST(NULL AS nvarchar(max)) AS JsonPart
    FROM #ExportManifest m
    UNION ALL
    SELECT 'DATA', r.TableName, r.RecordNumber, n.PartNumber,
        (DATALENGTH(r.RecordJson)/2 + 29999)/30000, DATALENGTH(r.RecordJson)/2,
        NULL, NULL,
        SUBSTRING(r.RecordJson COLLATE Latin1_General_100_BIN2, (n.PartNumber-1)*30000+1, 30000)
    FROM #ExportRecords r JOIN Numbers n ON n.PartNumber <= (DATALENGTH(r.RecordJson)/2+29999)/30000
)
SELECT RowType, TableName, RecordNumber, PartNumber, TotalParts, JsonCharacters,
       RecordCount, ExportStatus, JsonPart
FROM Output
ORDER BY TableName, RecordNumber, PartNumber;

-- No source INSERT/UPDATE/DELETE, schema changes or credentials are performed/exported.
-- Original image/PDF contents are on disk, not in these results. OcrJobs includes
-- storedFilename for locating those files. Copy files separately for previews.
-- July data is intentionally excluded: previous-month figures may need a separate export.
