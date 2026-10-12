import { z } from 'zod'
import { normalizeMonthlyDocumentDate } from './monthlyDocumentDate.js'

const nullableText = z.string().nullable()
const nullableNumber = z.number().nullable()
const MilkTypeCodeSchema = z.enum(['MILK-COW', 'MILK-SHEEP', 'MILK-GOAT', 'MILK-BUFF'])

export const CollectionRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  collectionCenter: nullableText,
  milkType: MilkTypeCodeSchema.nullable(),
  liters: nullableNumber,
  fatPercent: nullableNumber,
  density: nullableNumber,
  water: nullableNumber,
  temperature: nullableNumber,
  noticeNumber: nullableText,
  confidence: z.number().min(0).max(1),
  uncertainFields: z.array(z.string()),
})

export const MilkCollectionDocumentSchema = z.object({
  documentType: z.literal('daily_driver_statement'),
  companyName: nullableText,
  date: nullableText,
  driverName: nullableText,
  vehicleRegistration: nullableText,
  route: nullableText,
  rows: z.array(CollectionRowSchema),
  totalLiters: nullableNumber,
  warnings: z.array(z.string()),
  rawTranscription: z.string(),
})

export const MilkCollectionEditableDocumentSchema = MilkCollectionDocumentSchema.extend({
  rows: z.array(CollectionRowSchema.extend({ sampleId: nullableText.optional().default(null), manual: z.boolean().optional() })),
})

export const MonthlySettlementRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  producer: nullableText,
  centerName: nullableText,
  milkType: nullableText,
  liters: nullableNumber,
  ugPercent: nullableNumber,
  gValue: nullableNumber,
  confidence: z.number().min(0).max(1),
  uncertainFields: z.array(z.string()),
})

export const MonthlySettlementDocumentSchema = z.object({
  documentType: z.literal('journal_monthly_settlement'),
  layoutType: z.enum(['detailed', 'overview']),
  date: nullableText,
  documentMonth: z.number().int().min(1).max(12).nullable(),
  milkType: z.string(),
  headerCenterName: nullableText,
  totalLiters: nullableNumber,
  rows: z.array(MonthlySettlementRowSchema),
  warnings: z.array(z.string()),
  rawTranscription: z.string(),
})

export const MonthlySettlementEditableDocumentSchema = MonthlySettlementDocumentSchema.extend({
  date: nullableText.transform(normalizeMonthlyDocumentDate).refine(date => date !== null, {
    message: 'Enter a valid document date as DD/MM/YYYY (for example, 31/08/2026).',
  }),
  rows: z.array(MonthlySettlementRowSchema.extend({
    manual: z.boolean().optional(),
  })),
})
