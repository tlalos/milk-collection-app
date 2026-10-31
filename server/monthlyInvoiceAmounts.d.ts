export function pricingSubtotal(liters: number, price: number | null, commission: number | null, electricity: number | null): number | null
export function monthlyInvoiceAmounts(liters: number, price: number | null, commission: number | null, electricity: number | null, extra: boolean, regularVat: boolean, collector?: boolean): {
  adjustedPrice: number | null; result: number | null; roundingDifference: number | null
  extraAmount: number; vatStatusAmount: number; finalResult: number | null; blockReason: string | null
}
