export function pricingSubtotal(liters: number, price: number | null, commission: number | null, electricity: number | null): number | null {
  if (price === null && commission === null && electricity === null) return null
  const total = (price === null ? 0 : price * liters) + (commission ?? 0) + (electricity ?? 0)
  return Number.isFinite(total) ? total : null
}

function roundAmount(value: number, decimals = 2) {
  const factor = 10 ** decimals
  return Math.round((value + Number.EPSILON * Math.abs(value)) * factor) / factor
}

export function monthlyInvoiceAmounts(liters: number, price: number | null, commission: number | null, electricity: number | null, extra: boolean, regularVat: boolean, collector = false) {
  const subtotal = pricingSubtotal(liters, price, commission, electricity)
  const quantity = collector ? 1 : liters
  const blockReason = collector ? (liters !== 0 ? 'Collector milk quantity must be zero' : subtotal === null || subtotal <= 0 ? 'Enter a collector payment' : null)
    : price === null ? 'Collector procedure pending'
    : !Number.isFinite(liters) || liters <= 0 ? 'Missing liters'
    : subtotal === null ? 'No final result' : null
  const adjustedPrice = blockReason || subtotal === null ? null : roundAmount(subtotal / quantity, 6)
  const result = adjustedPrice === null ? null : roundAmount(adjustedPrice * quantity)
  const roundingDifference = result === null || subtotal === null ? null : roundAmount(result - roundAmount(subtotal))
  const extraAmount = result !== null && extra ? roundAmount(result * 0.08) : 0
  const vatStatusAmount = result !== null && !extra && regularVat ? roundAmount(result * 0.11) : 0
  const finalResult = result === null ? null : roundAmount(result + extraAmount + vatStatusAmount)
  return { adjustedPrice, result, roundingDifference, extraAmount, vatStatusAmount, finalResult, blockReason }
}
