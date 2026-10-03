export function pricingSubtotal(liters: number, price: number | null, commission: number | null, electricity: number | null): number | null {
  if (price === null && commission === null && electricity === null) return null
  const total = (price === null ? 0 : price * liters) + (commission ?? 0) + (electricity ?? 0)
  return Number.isFinite(total) ? total : null
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON * Math.abs(value)) * 100) / 100
}

export function monthlyInvoiceAmounts(liters: number, price: number | null, commission: number | null, electricity: number | null, extra: boolean, regularVat: boolean) {
  const subtotal = pricingSubtotal(liters, price, commission, electricity)
  const blockReason = price === null ? 'Collector procedure pending'
    : !Number.isFinite(liters) || liters <= 0 ? 'Missing liters'
    : subtotal === null ? 'No final result' : null
  const adjustedPrice = blockReason || subtotal === null ? null : roundMoney(subtotal / liters)
  const result = adjustedPrice === null ? null : roundMoney(adjustedPrice * liters)
  const roundingDifference = result === null || subtotal === null ? null : roundMoney(result - roundMoney(subtotal))
  const extraAmount = result !== null && extra ? roundMoney(result * 0.08) : 0
  const vatStatusAmount = result !== null && !extra && regularVat ? roundMoney(result * 0.11) : 0
  const finalResult = result === null ? null : roundMoney(result + extraAmount + vatStatusAmount)
  return { adjustedPrice, result, roundingDifference, extraAmount, vatStatusAmount, finalResult, blockReason }
}
