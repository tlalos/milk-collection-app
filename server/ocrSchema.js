import { z } from 'zod'

const nullableText = z.string().nullable()
const nullableNumber = z.number().nullable()

export const CollectionRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  collectionCenter: nullableText,
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
