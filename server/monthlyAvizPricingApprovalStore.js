import { createHash } from 'node:crypto'
import { getMilkReceptionPool } from './milkReceptionStore.js'

let initializePromise = null

// Prospective guards: legacy overlaps stay available for audited cancellation.
// Both triggers share the service lock and use locking reads even under RCSI.
export const approvalSourceGuardBatches = [
  `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.MonthlyAvizPricingApprovalLines') AND name=N'IX_MonthlyAvizPricingApprovalLines_Source')
    CREATE INDEX IX_MonthlyAvizPricingApprovalLines_Source ON dbo.MonthlyAvizPricingApprovalLines(jobId,rowNumber) INCLUDE(approvalId);`,
  `CREATE OR ALTER TRIGGER dbo.TR_MonthlyAvizPricingApprovalLines_Reserve
  ON dbo.MonthlyAvizPricingApprovalLines AFTER INSERT, UPDATE AS
  BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM inserted i LEFT JOIN deleted d ON d.approvalLineId=i.approvalLineId
      WHERE d.approvalLineId IS NULL OR i.approvalId<>d.approvalId OR i.jobId<>d.jobId OR i.rowNumber<>d.rowNumber) RETURN;
    DECLARE @lockResult INT;
    EXEC @lockResult=sp_getapplock @Resource=N'MonthlyAvizPricingApprovals',
      @LockMode=N'Exclusive',@LockOwner=N'Transaction',@LockTimeout=15000;
    IF @lockResult<0 THROW 51001,'Approval is busy. Try again.',1;
    IF EXISTS (
      SELECT 1 FROM inserted i
      LEFT JOIN deleted d ON d.approvalLineId=i.approvalLineId
      JOIN dbo.MonthlyAvizPricingApprovals a WITH (UPDLOCK,HOLDLOCK) ON a.approvalId=i.approvalId AND a.status<>N'CANCELLED'
      JOIN dbo.MonthlyAvizPricingApprovalLines otherLine WITH (UPDLOCK,HOLDLOCK)
        ON otherLine.jobId=i.jobId AND otherLine.rowNumber=i.rowNumber AND otherLine.approvalId<>i.approvalId
      JOIN dbo.MonthlyAvizPricingApprovals otherApproval WITH (UPDLOCK,HOLDLOCK)
        ON otherApproval.approvalId=otherLine.approvalId AND otherApproval.status<>N'CANCELLED'
      WHERE d.approvalLineId IS NULL OR i.approvalId<>d.approvalId OR i.jobId<>d.jobId OR i.rowNumber<>d.rowNumber
    ) THROW 51001,'An aviz source line is reserved by another active approval, including approvals needing review. Cancel the conflicting approval before reusing its lines.',1;
  END;`,
  `CREATE OR ALTER TRIGGER dbo.TR_MonthlyAvizPricingApprovals_Reserve
  ON dbo.MonthlyAvizPricingApprovals AFTER INSERT, UPDATE AS
  BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM inserted i LEFT JOIN deleted d ON d.approvalId=i.approvalId
      WHERE i.status<>N'CANCELLED' AND (d.approvalId IS NULL OR d.status=N'CANCELLED')) RETURN;
    DECLARE @lockResult INT;
    EXEC @lockResult=sp_getapplock @Resource=N'MonthlyAvizPricingApprovals',
      @LockMode=N'Exclusive',@LockOwner=N'Transaction',@LockTimeout=15000;
    IF @lockResult<0 THROW 51001,'Approval is busy. Try again.',1;
    IF EXISTS (
      SELECT 1 FROM inserted i LEFT JOIN deleted d ON d.approvalId=i.approvalId
      JOIN dbo.MonthlyAvizPricingApprovalLines ownLine WITH (UPDLOCK,HOLDLOCK) ON ownLine.approvalId=i.approvalId
      JOIN dbo.MonthlyAvizPricingApprovalLines otherLine WITH (UPDLOCK,HOLDLOCK)
        ON otherLine.jobId=ownLine.jobId AND otherLine.rowNumber=ownLine.rowNumber AND otherLine.approvalId<>i.approvalId
      JOIN dbo.MonthlyAvizPricingApprovals otherApproval WITH (UPDLOCK,HOLDLOCK)
        ON otherApproval.approvalId=otherLine.approvalId AND otherApproval.status<>N'CANCELLED'
      WHERE i.status<>N'CANCELLED' AND (d.approvalId IS NULL OR d.status=N'CANCELLED')
    ) THROW 51001,'An aviz source line is reserved by another active approval. This approval cannot be reactivated until the conflicting approval is cancelled.',1;
  END;`,
]

export async function initializeMonthlyAvizPricingApprovals() {
  if (!initializePromise) {
    initializePromise = (async () => {
      const pool = await getMilkReceptionPool()
      await pool.request().batch(`
IF OBJECT_ID(N'dbo.MonthlyAvizPricingApprovals', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.MonthlyAvizPricingApprovals (
    approvalId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_MonthlyAvizPricingApprovals PRIMARY KEY,
    monthKey CHAR(7) NOT NULL,
    centerCode NVARCHAR(80) NOT NULL,
    producerCode NVARCHAR(80) NOT NULL,
    milkType NVARCHAR(40) NOT NULL,
    centerName NVARCHAR(240) NOT NULL,
    producerName NVARCHAR(240) NOT NULL,
    approvedLiters DECIMAL(18,3) NOT NULL,
    sourceFingerprint CHAR(64) NOT NULL,
    status NVARCHAR(20) NOT NULL CONSTRAINT DF_MonthlyAvizPricingApprovals_Status DEFAULT N'APPROVED',
    approvedBy NVARCHAR(120) NOT NULL,
    approvedAt DATETIMEOFFSET NOT NULL CONSTRAINT DF_MonthlyAvizPricingApprovals_ApprovedAt DEFAULT SYSDATETIMEOFFSET(),
    note NVARCHAR(1000) NULL,
    reviewReason NVARCHAR(1000) NULL,
    reviewRequiredAt DATETIMEOFFSET NULL,
    cancelledBy NVARCHAR(120) NULL,
    cancelledAt DATETIMEOFFSET NULL,
    cancellationReason NVARCHAR(1000) NULL,
    CONSTRAINT CK_MonthlyAvizPricingApprovals_Month CHECK (
      monthKey LIKE '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND TRY_CONVERT(DATE, monthKey + '-01', 23) IS NOT NULL),
    CONSTRAINT CK_MonthlyAvizPricingApprovals_Liters CHECK (approvedLiters > 0),
    CONSTRAINT CK_MonthlyAvizPricingApprovals_Status CHECK (status IN (N'APPROVED',N'NEEDS_REVIEW',N'CANCELLED')),
    CONSTRAINT CK_MonthlyAvizPricingApprovals_Review CHECK (
      status <> N'NEEDS_REVIEW' OR (reviewRequiredAt IS NOT NULL AND LEN(LTRIM(RTRIM(reviewReason))) > 0 AND reviewReason IS NOT NULL)),
    CONSTRAINT CK_MonthlyAvizPricingApprovals_Cancel CHECK (
      (status = N'CANCELLED' AND cancelledAt IS NOT NULL AND cancelledBy IS NOT NULL AND LEN(LTRIM(RTRIM(cancelledBy))) > 0
       AND cancellationReason IS NOT NULL AND LEN(LTRIM(RTRIM(cancellationReason))) > 0)
      OR (status <> N'CANCELLED' AND cancelledAt IS NULL AND cancelledBy IS NULL AND cancellationReason IS NULL))
  );
END;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.MonthlyAvizPricingApprovals') AND name=N'UX_MonthlyAvizPricingApprovals_Active')
  CREATE UNIQUE INDEX UX_MonthlyAvizPricingApprovals_Active
  ON dbo.MonthlyAvizPricingApprovals(monthKey,centerCode,milkType) WHERE status <> N'CANCELLED';
IF OBJECT_ID(N'dbo.MonthlyAvizPricingApprovalLines', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.MonthlyAvizPricingApprovalLines (
    approvalLineId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_MonthlyAvizPricingApprovalLines PRIMARY KEY,
    approvalId UNIQUEIDENTIFIER NOT NULL,
    jobId NVARCHAR(64) NOT NULL,
    rowNumber INT NOT NULL,
    noticeNumber NVARCHAR(80) NULL,
    documentDate DATE NOT NULL,
    approvedLiters DECIMAL(18,3) NOT NULL,
    sourceFingerprint CHAR(64) NOT NULL,
    CONSTRAINT FK_MonthlyAvizPricingApprovalLines_Approval FOREIGN KEY (approvalId)
      REFERENCES dbo.MonthlyAvizPricingApprovals(approvalId),
    CONSTRAINT UQ_MonthlyAvizPricingApprovalLines_Source UNIQUE (approvalId,jobId,rowNumber),
    CONSTRAINT CK_MonthlyAvizPricingApprovalLines_Row CHECK (rowNumber > 0),
    CONSTRAINT CK_MonthlyAvizPricingApprovalLines_Liters CHECK (approvedLiters >= 0)
  );
END;
`)
      for (const batch of approvalSourceGuardBatches) await pool.request().batch(batch)
    })().catch((error) => {
      initializePromise = null
      throw error
    })
  }
  return initializePromise
}

const fingerprint = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const code = (value) => String(value || '').trim().toLowerCase()

// Called with server-loaded ERP references and aviz rows, never client-provided totals.
export function buildMonthlyAvizApprovalSnapshot({ monthKey, centerCode, milkType, producers, lines, hasJournal }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(monthKey || '')) throw new Error('Invalid approval month.')
  if (hasJournal) throw new Error('A monthly journal already exists.')
  if (!/^c\S+$/u.test(code(centerCode))) throw new Error('An ERP center code is required.')
  if (!['MILK-COW', 'MILK-BUFF', 'MILK-SHEEP', 'MILK-GOAT'].includes(milkType)) throw new Error('Invalid milk type.')
  const matches = producers.filter((producer) => code(producer.centerCode) === code(centerCode))
  if (matches.length !== 1 || !/^p\S+$/u.test(code(matches[0].producerCode))) {
    throw new Error('The center must belong to exactly one ERP producer.')
  }
  if (!Array.isArray(lines) || !lines.length) throw new Error('No aviz lines to approve.')
  const seen = new Set()
  const snapshotLines = lines.map((line) => {
    const identity = `${line.jobId}:${line.rowNumber}`
    if (!line.jobId || String(line.jobId).length > 64 || !Number.isInteger(line.rowNumber) || line.rowNumber <= 0 || seen.has(identity)) {
      throw new Error('Invalid or duplicate aviz line.')
    }
    seen.add(identity)
    const date = String(line.documentDate || '')
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || !date.startsWith(`${monthKey}-`) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
      throw new Error('Aviz date is outside the approval month or invalid.')
    }
    if (typeof line.liters !== 'number' || !Number.isFinite(line.liters) || line.liters < 0 || Math.abs(line.liters * 1000 - Math.round(line.liters * 1000)) > 0.000001) {
      throw new Error('Aviz liters must be nonnegative with at most three decimals.')
    }
    const result = { jobId: String(line.jobId), rowNumber: line.rowNumber, documentDate: date, noticeNumber: line.noticeNumber || null, approvedLiters: line.liters }
    return { ...result, sourceFingerprint: fingerprint({ ...result, centerCode: code(centerCode), milkType }) }
  }).sort((a, b) => a.jobId.localeCompare(b.jobId) || a.rowNumber - b.rowNumber)
  const units = snapshotLines.reduce((sum, line) => sum + Math.round(line.approvedLiters * 1000), 0)
  if (!Number.isSafeInteger(units) || units <= 0) throw new Error('Invalid total aviz liters.')
  const result = { monthKey, centerCode: code(centerCode), producerCode: code(matches[0].producerCode), milkType, approvedLiters: units / 1000, lines: snapshotLines }
  return { ...result, sourceFingerprint: fingerprint(result) }
}
