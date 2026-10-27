export function isKgOnlyDelivery(milkType) {
  return ['WHEY', 'LACTOSE'].includes(String(milkType || '').trim().toUpperCase())
}

export function deliveryLiters(milkType, netQuantityKg, densityFactor) {
  if (isKgOnlyDelivery(milkType) || netQuantityKg === null || !Number.isFinite(netQuantityKg) ||
    !Number.isFinite(densityFactor) || densityFactor <= 0) return null
  return netQuantityKg / densityFactor
}
