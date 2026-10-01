export function pricingSubtotal(liters: number, price: number | null, commission: number | null, electricity: number | null): number | null {
  if (price === null && commission === null && electricity === null) return null
  const total = (price === null ? 0 : price * liters) + (commission ?? 0) + (electricity ?? 0)
  return Number.isFinite(total) ? total : null
}

export function monthlyInvoiceAmounts(liters: number, price: number | null, commission: number | null, electricity: number | null, extra: boolean, regularVat: boolean) {
  const subtotal = pricingSubtotal(liters, price, commission, electricity)
  const blockReason = price === null ? 'Collector procedure pending'
    : !Number.isFinite(liters) || liters <= 0 ? 'Missing liters'
    : subtotal === null ? 'No final result' : null
  const adjustedPrice = blockReason || subtotal === null ? null : subtotal / liters
  const result = adjustedPrice === null ? null : subtotal
  const extraAmount = result !== null && extra ? result * 0.08 : 0
  const vatStatusAmount = result !== null && !extra && regularVat ? result * 0.11 : 0
  const finalResult = result === null ? null : result + extraAmount + vatStatusAmount
  return { adjustedPrice, result, extraAmount, vatStatusAmount, finalResult, blockReason }
}
