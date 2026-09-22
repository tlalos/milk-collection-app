import {
  listMilkReceptionDrivers,
  listMilkReceptionRouteSettings,
  listMilkReceptions,
} from './milkReceptionStore.js'

const COLLECTION_CATEGORY = 'COLLECTION'

export async function listDailyOcrDrivers(query = '') {
  const settings = await listMilkReceptionDrivers()
  return filterValues(settings.map((setting) => setting.driverName), query)
}

export async function listDailyOcrVehicles(query = '') {
  const settings = await listMilkReceptionRouteSettings()
  const vehicles = collectionVehicleRoutes(settings).map((item) => item.vehicle)
  return filterValues(vehicles, query)
}

export async function listDailyOcrRoutes(vehicleRegistration = '', query = '') {
  const settings = await listMilkReceptionRouteSettings()
  const groups = collectionVehicleRoutes(settings)
  const vehicle = normalizeValue(vehicleRegistration)
  const routes = vehicle
    ? groups.find((item) => normalizeValue(item.vehicle) === vehicle)?.routes || []
    : groups.flatMap((item) => item.routes)
  return filterValues(routes, query)
}

export async function matchDailyOcrDriver(driverName) {
  const originalName = String(driverName || '').trim()
  if (!originalName) return { originalName: driverName || null, status: 'unmatched', selectedName: null, score: 0 }
  const drivers = await listDailyOcrDrivers()
  const best = drivers
    .map((name) => ({ name, score: driverSimilarity(originalName, name) }))
    .sort((left, right) => right.score - left.score)[0]
  const autoReplace = best?.score >= 0.3
  return {
    originalName,
    status: autoReplace ? 'auto_replaced' : 'unmatched',
    selectedName: autoReplace ? best.name : null,
    score: Number((best?.score || 0).toFixed(3)),
  }
}

export async function matchDailyOcrVehicle(vehicleRegistration) {
  const originalValue = String(vehicleRegistration || '').trim()
  if (!originalValue) return { originalValue: vehicleRegistration || null, status: 'unmatched', selectedValue: null, score: 0 }
  const vehicles = await listDailyOcrVehicles()
  const best = vehicles
    .map((value) => ({ value, score: vehicleSimilarity(originalValue, value) }))
    .sort((left, right) => right.score - left.score)[0]
  const autoReplace = best?.score >= 0.3
  return {
    originalValue,
    status: autoReplace ? 'auto_replaced' : 'unmatched',
    selectedValue: autoReplace ? best.value : null,
    score: Number((best?.score || 0).toFixed(3)),
  }
}

export async function resolveDailyOcrRoute(date, vehicleRegistration) {
  const vehicle = String(vehicleRegistration || '').trim()
  if (!date || !vehicle) {
    return { status: 'unmatched', selectedRoute: null, date: date || null, vehicle: vehicle || null, existingRoutes: [] }
  }

  const settings = await listMilkReceptionRouteSettings()
  const vehicleRoutes = collectionVehicleRoutes(settings)
    .find((item) => normalizeValue(item.vehicle) === normalizeValue(vehicle))
  if (!vehicleRoutes?.routes.length) {
    return { status: 'unmatched', selectedRoute: null, date, vehicle, existingRoutes: [] }
  }

  const receptions = await listMilkReceptions({ date })
  const existingRoutes = uniqueValues(receptions
    .filter((record) => (
      normalizeValue(record.vehicleRegistration) === normalizeValue(vehicleRoutes.vehicle) &&
      String(record.vehicleCategory || '').toUpperCase() === COLLECTION_CATEGORY
    ))
    .map((record) => record.routeId))
  const selectedRoute = vehicleRoutes.routes.find((route) => (
    !existingRoutes.some((existing) => normalizeValue(existing) === normalizeValue(route))
  )) || vehicleRoutes.routes.at(-1) || null

  return {
    status: selectedRoute ? 'resolved' : 'unmatched',
    selectedRoute,
    date,
    vehicle: vehicleRoutes.vehicle,
    existingRoutes,
    optionIndex: selectedRoute ? vehicleRoutes.routes.indexOf(selectedRoute) : null,
  }
}

function collectionVehicleRoutes(settings) {
  return (settings.vehicleRoutes || [])
    .filter((item) => String(item.vehicleCategory || '').toUpperCase() === COLLECTION_CATEGORY)
    .map((item) => ({
      vehicle: String(item.vehicle || '').trim(),
      routes: uniqueValues(item.routes),
    }))
    .filter((item) => item.vehicle && item.routes.length)
}

function filterValues(values, query = '') {
  const search = normalizeValue(query)
  return uniqueValues(values)
    .filter((value) => !search || normalizeValue(value).includes(search))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
}

function uniqueValues(values) {
  const seen = new Set()
  const output = []
  for (const rawValue of values || []) {
    const value = String(rawValue || '').trim()
    const key = normalizeValue(value)
    if (!value || !key || seen.has(key)) continue
    seen.add(key)
    output.push(value)
  }
  return output
}

function normalizeValue(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ')
}

function driverSimilarity(leftValue, rightValue) {
  const left = normalizeValue(leftValue)
  const right = normalizeValue(rightValue)
  const baseScore = similarity(left, right)
  if (!left || !right) return baseScore
  const leftTokens = left.split(' ')
  const rightTokens = right.split(' ')
  const wholeWordMatch = leftTokens.includes(right) || rightTokens.includes(left)
  const tokenScore = Math.max(...leftTokens.flatMap((leftToken) => (
    rightTokens.map((rightToken) => similarity(leftToken, rightToken))
  )), 0)
  return Math.max(baseScore, wholeWordMatch ? 0.9 : 0, tokenScore >= 0.5 ? tokenScore : 0)
}

function vehicleSimilarity(leftValue, rightValue) {
  const left = normalizeValue(leftValue).replace(/\s+/gu, '')
  const right = normalizeValue(rightValue).replace(/\s+/gu, '')
  if (!left || !right) return 0
  if (left === right) return 1
  return 1 - levenshtein(left, right) / Math.max(left.length, right.length)
}

function similarity(left, right) {
  if (!left || !right) return 0
  if (left === right) return 1
  return 1 - levenshtein(left, right) / Math.max(left.length, right.length)
}

function levenshtein(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      )
    }
    previous.splice(0, previous.length, ...current)
  }
  return previous[right.length]
}
