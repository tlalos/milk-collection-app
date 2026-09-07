import { Fragment, useEffect, useMemo, useState } from 'react'
import './MilkReceptionScreen.css'
import { appPath } from '../ocrPaths'
import { db } from '../db/database'
import type { LocalTruck } from '../types/trucks'

interface MilkReceptionScreenProps {
  onBack: () => void
}

interface MilkTypeOption {
  code: string
  label: string
  displayName: string
  densityFactor: number
}

interface MilkReceptionOptions {
  milkTypes: MilkTypeOption[]
  categories: string[]
  antibioticResults: string[]
  conformityResults: string[]
  tanks: string[]
  vehicles: string[]
  routes: string[]
  drivers: string[]
  vehicleRoutes: Array<{ vehicle: string; vehicleCategory?: VehicleCategory; routes: string[] }>
  routeSettings: RouteSetting[]
  driverSettings: DriverSetting[]
  vehicleCategories: VehicleCategory[]
}

type VehicleCategory = 'COLLECTION' | 'OTHER'
type QualityDetailType = 'ORIGINAL' | 'CUSTOM'
type DetailSectionType = 'RECONCILIATION' | QualityDetailType

interface RouteSetting {
  settingId: string
  vehicleRegistration: string
  vehicleCategory: VehicleCategory
  routeId: string
  routeOrder?: number | null
}

interface DriverSetting {
  driverId: string
  driverName: string
  sortOrder?: number | null
}

interface QualityDetail {
  detailType: QualityDetailType
  exteriorTemperatureC: number | string | null
  accessAt: string
  receptionAt: string
  antibioticPccResult: string
  ph: number | string | null
  productTemperatureC: number | string | null
  fatResult: number | string | null
  waterPercentage: number | string | null
  proteinResult: number | string | null
  tankNumber: string
  conformityResult: string
  productionEntryAt: string
  productionExitAt: string
  responsiblePerson: string
  pcc1Observations: string
}

interface MilkReceptionReconciliationRow {
  rowNumber: number | null
  center: string
  milkType: string
  liters: number | null
  noticeNumber: string
  sourceFile: string
}

interface MilkReceptionReconciliation {
  status: 'not_collection' | 'missing_info' | 'no_truck' | 'no_date' | 'no_route' | 'ok' | 'difference'
  label: string
  avizLiters: number | null
  differenceLiters: number | null
  differencePercent: number | null
  matchedRowCount: number
  suggestedRoutes: string[]
  matchedRows: MilkReceptionReconciliationRow[]
}

interface MilkReceptionRecord {
  receptionId: string
  receptionDate: string
  vehicleRegistration: string
  vehicleCategory: VehicleCategory
  routeId: string
  milkType: string
  milkTypeLabel: string
  driverName: string
  densityFactor: number | string
  fullTruckWeightKg: number | string | null
  emptyTruckWeightKg: number | string | null
  netQuantityKg: number | null
  calculatedLiters: number | null
  deliveryCategory: string
  comments: string
  dailyRoutesLiters: number | string | null
  differenceLiters: number | null
  vehicleCountSource: number | string | null
  routeCountSource: number | string | null
  combinationDiagnosis: string
  exteriorTemperatureC: number | string | null
  accessTime: string
  receptionTime: string
  antibioticPccResult: string
  ph: number | string | null
  productTemperatureC: number | string | null
  fatResult: number | string | null
  waterPercentage: number | string | null
  proteinResult: number | string | null
  tankNumber: string
  conformityResult: string
  productionEntryAt: string
  productionExitAt: string
  responsiblePerson: string
  pcc1Observations: string
  qualityDetails: Record<QualityDetailType, QualityDetail>
  reconciliation?: MilkReceptionReconciliation
  createdAt?: string
  updatedAt?: string
  isNew?: boolean
}

const defaultOptions: MilkReceptionOptions = {
  milkTypes: [
    { code: 'MILK-COW', label: 'Lapte de vacă', displayName: 'Cow milk', densityFactor: 1.03 },
    { code: 'MILK-SHEEP', label: 'Lapte de oaie', displayName: 'Sheep milk', densityFactor: 1.036 },
    { code: 'MILK-GOAT', label: 'Lapte de capră', displayName: 'Goat milk', densityFactor: 1.03 },
    { code: 'MILK-BUFF', label: 'Lapte de bivoliță', displayName: 'Buffalo milk', densityFactor: 1.04 },
  ],
  categories: ['COLLECTION', 'OTHERS'],
  antibioticResults: ['Negative / Pass', 'Positive / Fail', 'Pending', 'Not Tested'],
  conformityResults: ['Conforming', 'Non-Conforming', 'Pending', 'Conditionally Accepted'],
  tanks: ['1', '2', '3', '4', '5', '6'],
  vehicles: [],
  routes: ['R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08', 'R20'],
  drivers: [],
  vehicleRoutes: [],
  routeSettings: [],
  driverSettings: [],
  vehicleCategories: ['COLLECTION', 'OTHER'],
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function numberValue(value: unknown) {
  if (value === '' || value === null || value === undefined) return null
  const parsed = Number(String(value).replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function formatNumber(value: number | null, decimals = 1) {
  return value == null ? '-' : value.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals })
}

function emptyQualityDetail(detailType: QualityDetailType): QualityDetail {
  return {
    detailType,
    exteriorTemperatureC: '',
    accessAt: '',
    receptionAt: '',
    antibioticPccResult: '',
    ph: '',
    productTemperatureC: '',
    fatResult: '',
    waterPercentage: '',
    proteinResult: '',
    tankNumber: '',
    conformityResult: '',
    productionEntryAt: '',
    productionExitAt: '',
    responsiblePerson: '',
    pcc1Observations: '',
  }
}

function normalizeQualityDetail(detailType: QualityDetailType, detail?: Partial<QualityDetail>): QualityDetail {
  return { ...emptyQualityDetail(detailType), ...(detail || {}), detailType }
}

function normalizeQualityDetails(details?: Partial<Record<QualityDetailType, Partial<QualityDetail>>>) {
  return {
    ORIGINAL: normalizeQualityDetail('ORIGINAL', details?.ORIGINAL),
    CUSTOM: normalizeQualityDetail('CUSTOM', details?.CUSTOM),
  }
}

function displayDateTimeInput(value: string) {
  const text = String(value || '').trim()
  if (!text) return ''
  const date = new Date(text)
  if (!Number.isFinite(date.getTime())) return text
  const two = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`
}

function storedDateTimeInput(value: string) {
  const text = String(value || '').trim()
  if (!text) return ''
  const nativeMatch = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u.exec(text)
  if (nativeMatch) {
    const [, year, month, day, hour, minute] = nativeMatch
    const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute))
    if (Number.isFinite(date.getTime())) return date.toISOString()
  }
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[\s,]+(\d{1,2}):(\d{2}))?$/u.exec(text)
  if (match) {
    const [, month, day, year, hour = '0', minute = '0'] = match
    const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute))
    if (Number.isFinite(date.getTime())) return date.toISOString()
  }
  return text
}

function compactReceptionId(record: MilkReceptionRecord) {
  if (record.isNew) return 'New'
  const parts = record.receptionId.split('-').filter(Boolean)
  return parts[parts.length - 1] || record.receptionId.slice(-6)
}

export function MilkReceptionScreen({ onBack }: MilkReceptionScreenProps) {
  const [records, setRecords] = useState<MilkReceptionRecord[]>([])
  const [options, setOptions] = useState<MilkReceptionOptions>(defaultOptions)
  const [localTrucks, setLocalTrucks] = useState<LocalTruck[]>([])
  const [expandedId, setExpandedId] = useState('')
  const [filterDate, setFilterDate] = useState(today())
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [savingId, setSavingId] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'TRUCKS' | 'DRIVERS'>('TRUCKS')
  const [settingsTypeFilter, setSettingsTypeFilter] = useState<'ALL' | VehicleCategory>('ALL')
  const [newSettingsTruck, setNewSettingsTruck] = useState('')
  const [newSettingsCategory, setNewSettingsCategory] = useState<VehicleCategory>('OTHER')
  const [newSettingsRoutes, setNewSettingsRoutes] = useState('')
  const [newDriverName, setNewDriverName] = useState('')
  const [routeDrafts, setRouteDrafts] = useState<Record<string, string>>({})
  const [categoryDrafts, setCategoryDrafts] = useState<Record<string, VehicleCategory>>({})
  const [settingsBusy, setSettingsBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [detailSectionOpen, setDetailSectionOpen] = useState<Record<string, boolean>>({})

  useEffect(() => {
    void loadOptions()
    void loadLocalTrucks()
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadRecords(), 220)
    return () => window.clearTimeout(timer)
  }, [filterDate, search])

  useEffect(() => {
    setRouteDrafts((current) => {
      const next: Record<string, string> = {}
      for (const group of options.vehicleRoutes) {
        if (!group.vehicle) continue
        next[group.vehicle] = current[group.vehicle] ?? group.routes.join(', ')
      }
      return next
    })
    setCategoryDrafts((current) => {
      const next: Record<string, VehicleCategory> = {}
      for (const group of options.vehicleRoutes) {
        if (!group.vehicle) continue
        next[group.vehicle] = current[group.vehicle] ?? normalizeVehicleCategory(group.vehicleCategory)
      }
      return next
    })
  }, [options.vehicleRoutes])

  const visibleRecords = useMemo(() => records, [records])
  const savedVehicleRoutes = useMemo(() => options.vehicleRoutes.filter((group) => group.vehicle), [options.vehicleRoutes])
  const visibleVehicleRoutes = useMemo(() => {
    if (settingsTypeFilter === 'ALL') return savedVehicleRoutes
    return savedVehicleRoutes.filter((group) => normalizeVehicleCategory(group.vehicleCategory) === settingsTypeFilter)
  }, [savedVehicleRoutes, settingsTypeFilter])
  const knownRouteValues = useMemo(() => {
    const values = new Set<string>()
    options.routes.forEach((route) => values.add(route))
    options.vehicleRoutes.forEach((group) => group.routes?.forEach((route) => values.add(route)))
    return [...values].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
  }, [options.routes, options.vehicleRoutes])
  const driverOptions = useMemo(() => {
    const values = new Set<string>()
    options.drivers.forEach((driver) => {
      const name = normalizeName(driver)
      if (name) values.add(name)
    })
    options.driverSettings.forEach((driver) => {
      const name = normalizeName(driver.driverName)
      if (name) values.add(name)
    })
    return [...values].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
  }, [options.drivers, options.driverSettings])
  const truckOptions = useMemo(() => {
    const syncedTrucks = localTrucks.map((truck) => ({
      value: truck.truck_code,
      label: `${truck.truck_code}${truck.truck_name ? ` - ${truck.truck_name}` : ''}`,
    }))
    const referenceTrucks = options.vehicles.map((vehicle) => ({ value: vehicle, label: vehicle }))
    const map = new Map<string, { value: string; label: string }>()
    for (const truck of [...syncedTrucks, ...referenceTrucks]) {
      if (truck.value && !map.has(truck.value)) map.set(truck.value, truck)
    }
    return [...map.values()].sort((left, right) => left.value.localeCompare(right.value, undefined, { numeric: true }))
  }, [localTrucks, options.vehicles])

  function truckOptionsForCategory(vehicleCategory: VehicleCategory) {
    const savedForType = savedVehicleRoutes.filter((group) => normalizeVehicleCategory(group.vehicleCategory) === vehicleCategory)
    if (savedForType.length) {
      const allowed = new Set(savedForType.map((group) => normalizeText(group.vehicle)))
      return truckOptions.filter((truck) => allowed.has(normalizeText(truck.value)))
    }
    return truckOptions
  }

  function detailSectionKey(receptionId: string, sectionType: DetailSectionType) {
    return `${receptionId}:${sectionType}`
  }

  function isDetailSectionOpen(receptionId: string, sectionType: DetailSectionType) {
    return detailSectionOpen[detailSectionKey(receptionId, sectionType)] ?? true
  }

  function updateDetailSectionOpen(receptionId: string, sectionType: DetailSectionType, open: boolean) {
    const key = detailSectionKey(receptionId, sectionType)
    setDetailSectionOpen((current) => current[key] === open ? current : { ...current, [key]: open })
  }

  async function loadLocalTrucks() {
    try {
      setLocalTrucks(await db.trucks.orderBy('truck_code').toArray())
    } catch {
      setLocalTrucks([])
    }
  }

  async function loadOptions() {
    try {
      const response = await fetch(appPath('/api/milk-receptions/options'))
      const payload = await response.json()
      if (response.ok && payload.options) {
        setOptions({
          ...defaultOptions,
          ...payload.options,
          milkTypes: payload.options.milkTypes?.length ? payload.options.milkTypes : defaultOptions.milkTypes,
          categories: payload.options.categories?.length ? payload.options.categories : defaultOptions.categories,
          antibioticResults: payload.options.antibioticResults?.length ? payload.options.antibioticResults : defaultOptions.antibioticResults,
          conformityResults: payload.options.conformityResults?.length ? payload.options.conformityResults : defaultOptions.conformityResults,
          tanks: payload.options.tanks?.length ? payload.options.tanks : defaultOptions.tanks,
          routes: payload.options.routes?.length ? payload.options.routes : defaultOptions.routes,
          drivers: payload.options.drivers || [],
          vehicles: payload.options.vehicles || [],
          vehicleRoutes: payload.options.vehicleRoutes || [],
          routeSettings: payload.options.routeSettings || [],
          driverSettings: payload.options.driverSettings || [],
          vehicleCategories: payload.options.vehicleCategories?.length ? payload.options.vehicleCategories : defaultOptions.vehicleCategories,
        })
      }
    } catch {
      setOptions(defaultOptions)
    }
  }

  async function loadRecords() {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (filterDate) params.set('date', filterDate)
      if (search.trim()) params.set('search', search.trim())
      const response = await fetch(appPath(`/api/milk-receptions?${params.toString()}`))
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not load milk receptions.')
      setRecords((payload.records || []).map((record: MilkReceptionRecord) => ({
        ...record,
        driverName: record.driverName || '',
        qualityDetails: normalizeQualityDetails(record.qualityDetails),
        vehicleCategory: normalizeVehicleCategory(record.vehicleCategory),
        isNew: false,
      })))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load milk receptions.')
    } finally {
      setLoading(false)
    }
  }

  function addRow() {
    const milk = options.milkTypes[0]
    const id = `new-${Date.now()}`
    setNotice('')
    setError('')
    setExpandedId(id)
    setRecords((current) => [
      {
        receptionId: id,
        receptionDate: filterDate || today(),
        vehicleRegistration: '',
        vehicleCategory: 'COLLECTION',
        routeId: '',
        milkType: milk.code,
        milkTypeLabel: milk.label,
        driverName: '',
        densityFactor: milk.densityFactor,
        fullTruckWeightKg: '',
        emptyTruckWeightKg: '',
        netQuantityKg: null,
        calculatedLiters: null,
        deliveryCategory: 'COLLECTION',
        comments: '',
        dailyRoutesLiters: null,
        differenceLiters: null,
        vehicleCountSource: null,
        routeCountSource: null,
        combinationDiagnosis: 'Incomplete information',
        exteriorTemperatureC: null,
        accessTime: '',
        receptionTime: '',
        antibioticPccResult: 'Pending',
        ph: null,
        productTemperatureC: null,
        fatResult: null,
        waterPercentage: null,
        proteinResult: null,
        tankNumber: '',
        conformityResult: 'Pending',
        productionEntryAt: '',
        productionExitAt: '',
        responsiblePerson: '',
        pcc1Observations: '',
        qualityDetails: normalizeQualityDetails(),
        isNew: true,
      },
      ...current,
    ])
  }

  function updateRecord(id: string, patch: Partial<MilkReceptionRecord>) {
    setRecords((current) => current.map((record) => {
      if (record.receptionId !== id) return record
      const next = { ...record, ...patch }
      if (patch.milkType) {
        const milk = options.milkTypes.find((item) => item.code === patch.milkType)
        if (milk) {
          next.milkTypeLabel = milk.label
          next.densityFactor = milk.densityFactor
        }
      }
      if (patch.vehicleRegistration !== undefined) {
        const vehicleSetting = vehicleSettingFor(patch.vehicleRegistration)
        if (vehicleSetting?.vehicleCategory) next.vehicleCategory = normalizeVehicleCategory(vehicleSetting.vehicleCategory)
        const routes = routeOptionsForVehicle(patch.vehicleRegistration)
        if (routes.length && !routes.includes(String(next.routeId || '').trim())) next.routeId = routes[0]
        if (!routes.length && next.vehicleCategory === 'OTHER') next.routeId = ''
      }
      if (patch.vehicleCategory !== undefined) {
        next.vehicleCategory = normalizeVehicleCategory(patch.vehicleCategory)
        next.deliveryCategory = next.vehicleCategory === 'OTHER' ? 'OTHERS' : 'COLLECTION'
        const selectedVehicle = vehicleSettingFor(next.vehicleRegistration)
        if (selectedVehicle && normalizeVehicleCategory(selectedVehicle.vehicleCategory) !== next.vehicleCategory) {
          next.vehicleRegistration = ''
          next.routeId = ''
        }
        if (next.vehicleCategory === 'OTHER') {
          next.routeId = ''
        } else {
          const routes = routeOptionsForVehicle(next.vehicleRegistration)
          if (routes.length && !routes.includes(String(next.routeId || '').trim())) next.routeId = routes[0]
        }
      }
      return withCalculations(next)
    }))
  }

  function updateQualityDetail(id: string, detailType: QualityDetailType, patch: Partial<QualityDetail>) {
    setRecords((current) => current.map((record) => {
      if (record.receptionId !== id) return record
      const qualityDetails = normalizeQualityDetails(record.qualityDetails)
      const next = {
        ...record,
        qualityDetails: {
          ...qualityDetails,
          [detailType]: {
            ...qualityDetails[detailType],
            ...patch,
            detailType,
          },
        },
      }
      return withCalculations(next)
    }))
  }

  function vehicleSettingFor(vehicleRegistration: string) {
    const normalizedVehicle = normalizeText(vehicleRegistration)
    return options.vehicleRoutes.find((item) => normalizeText(item.vehicle) === normalizedVehicle)
  }

  function routeOptionsForVehicle(vehicleRegistration: string) {
    const vehicleSetting = vehicleSettingFor(vehicleRegistration)
    const specificRoutes = vehicleSetting?.routes?.filter(Boolean) || []
    if (vehicleSetting && !specificRoutes.length) return []
    return specificRoutes.length ? specificRoutes : options.routes
  }

  async function saveTruckRoutes(vehicleRegistration: string, routesText: string, vehicleCategory: VehicleCategory) {
    const truck = vehicleRegistration.trim()
    const routes = routesTextToArray(routesText)
    if (!truck) {
      setError('Truck ID is required.')
      return
    }
    setSettingsBusy(truck)
    setError('')
    setNotice('')
    try {
      const response = await fetch(appPath(`/api/milk-receptions/route-settings/truck/${encodeURIComponent(truck)}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routes, vehicleCategory }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not save truck routes.')
      await loadOptions()
      setNewSettingsTruck('')
      setNewSettingsRoutes('')
      setNewSettingsCategory('OTHER')
      setNotice(`Routes saved for truck ${truck.toUpperCase()}.`)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save truck routes.')
    } finally {
      setSettingsBusy('')
    }
  }

  async function deleteTruckRoutes(vehicleRegistration: string) {
    const truck = vehicleRegistration.trim()
    if (!truck) return
    setSettingsBusy(`delete-${truck}`)
    setError('')
    setNotice('')
    try {
      const response = await fetch(appPath(`/api/milk-receptions/route-settings/truck/${encodeURIComponent(truck)}`), { method: 'DELETE' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not delete truck routes.')
      await loadOptions()
      setNotice(`Truck ${truck.toUpperCase()} removed from route settings.`)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete truck routes.')
    } finally {
      setSettingsBusy('')
    }
  }

  async function importRouteSettingsFromExcel() {
    setSettingsBusy('importing')
    setError('')
    setNotice('')
    try {
      const response = await fetch(appPath('/api/milk-receptions/route-settings/import-excel'), { method: 'POST' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not import truck-route settings from Excel.')
      await loadOptions()
      setNotice(`Imported ${payload.result?.imported || 0} truck-route settings from Excel.`)
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Could not import truck-route settings from Excel.')
    } finally {
      setSettingsBusy('')
    }
  }

  async function saveDriver() {
    const driverName = normalizeName(newDriverName)
    if (!driverName) {
      setError('Driver name is required.')
      return
    }
    setSettingsBusy('driver-add')
    setError('')
    setNotice('')
    try {
      const response = await fetch(appPath('/api/milk-receptions/driver-settings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driverName, sortOrder: options.driverSettings.length + 1 }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not save driver.')
      await loadOptions()
      setNewDriverName('')
      setNotice(`Driver ${driverName} saved.`)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save driver.')
    } finally {
      setSettingsBusy('')
    }
  }

  async function deleteDriver(driver: DriverSetting) {
    if (!driver.driverId) return
    setSettingsBusy(`driver-delete-${driver.driverId}`)
    setError('')
    setNotice('')
    try {
      const response = await fetch(appPath(`/api/milk-receptions/driver-settings/${encodeURIComponent(driver.driverId)}`), { method: 'DELETE' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not delete driver.')
      await loadOptions()
      setNotice(`Driver ${driver.driverName} removed from settings.`)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete driver.')
    } finally {
      setSettingsBusy('')
    }
  }

  async function importDriversFromExcel() {
    setSettingsBusy('driver-importing')
    setError('')
    setNotice('')
    try {
      const response = await fetch(appPath('/api/milk-receptions/driver-settings/import-excel'), { method: 'POST' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not import drivers from Excel.')
      await loadOptions()
      setNotice(`Imported ${payload.result?.imported || 0} drivers from Excel.`)
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Could not import drivers from Excel.')
    } finally {
      setSettingsBusy('')
    }
  }

  async function saveRecord(record: MilkReceptionRecord) {
    const validation = validate(record)
    if (validation) {
      setError(validation)
      return
    }

    setSavingId(record.receptionId)
    setError('')
    setNotice('')
    try {
      const response = await fetch(record.isNew ? appPath('/api/milk-receptions') : appPath(`/api/milk-receptions/${encodeURIComponent(record.receptionId)}`), {
        method: record.isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not save milk reception.')
      const savedRecord = { ...payload.record, qualityDetails: normalizeQualityDetails(payload.record.qualityDetails), isNew: false }
      setRecords((current) => current.map((item) => item.receptionId === record.receptionId ? savedRecord : item))
      setExpandedId(payload.record.receptionId)
      setNotice(`Reception ${payload.record.receptionId} saved.`)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save milk reception.')
    } finally {
      setSavingId('')
    }
  }

  async function deleteRecord(record: MilkReceptionRecord) {
    if (record.isNew) {
      setRecords((current) => current.filter((item) => item.receptionId !== record.receptionId))
      return
    }
    setSavingId(record.receptionId)
    setError('')
    try {
      const response = await fetch(appPath(`/api/milk-receptions/${encodeURIComponent(record.receptionId)}`), { method: 'DELETE' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not delete milk reception.')
      setRecords((current) => current.filter((item) => item.receptionId !== record.receptionId))
      setNotice(`Reception ${record.receptionId} deleted.`)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete milk reception.')
    } finally {
      setSavingId('')
    }
  }

  function renderQualitySection(record: MilkReceptionRecord, detailType: QualityDetailType, title: string) {
    const detail = normalizeQualityDetails(record.qualityDetails)[detailType]
    const className = detailType === 'ORIGINAL' ? 'original-detail' : 'custom-detail'
    return (
      <details
        className={`detail-section-card quality-detail-card ${className}`}
        open={isDetailSectionOpen(record.receptionId, detailType)}
        onToggle={(event) => updateDetailSectionOpen(record.receptionId, detailType, event.currentTarget.open)}
      >
        <summary className="detail-section-summary">{title}</summary>
        {detailType === 'ORIGINAL' && <button type="button" className="quality-picture-button" title="Picture OCR will be added later">Picture</button>}
        <div className="quality-detail-grid">
          <label className="detail-field-compact"><span>Temp. exterior (°C)</span><input inputMode="decimal" value={detail.exteriorTemperatureC ?? ''} onChange={(event) => updateQualityDetail(record.receptionId, detailType, { exteriorTemperatureC: event.target.value })} /></label>
          <label className="detail-field-datetime"><span>Data/ora acces</span><input type="datetime-local" lang="en-GB" step="60" value={displayDateTimeInput(detail.accessAt)} onChange={(event) => updateQualityDetail(record.receptionId, detailType, { accessAt: storedDateTimeInput(event.target.value) })} /></label>
          <label className="detail-field-datetime"><span>Data/ora recepție</span><input type="datetime-local" lang="en-GB" step="60" value={displayDateTimeInput(detail.receptionAt)} onChange={(event) => updateQualityDetail(record.receptionId, detailType, { receptionAt: storedDateTimeInput(event.target.value) })} /></label>
          <label className="detail-field-choice"><span>Antib. PCC</span><select value={detail.antibioticPccResult} onChange={(event) => updateQualityDetail(record.receptionId, detailType, { antibioticPccResult: event.target.value })}><option value="">Select</option>{options.antibioticResults.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label className="detail-field-short"><span>pH</span><input inputMode="decimal" value={detail.ph ?? ''} onChange={(event) => updateQualityDetail(record.receptionId, detailType, { ph: event.target.value })} /></label>
          <label className="detail-field-short"><span>T produs (°C)</span><input inputMode="decimal" value={detail.productTemperatureC ?? ''} onChange={(event) => updateQualityDetail(record.receptionId, detailType, { productTemperatureC: event.target.value })} /></label>
          <label className="detail-field-short"><span>Gr</span><input inputMode="decimal" value={detail.fatResult ?? ''} onChange={(event) => updateQualityDetail(record.receptionId, detailType, { fatResult: event.target.value })} /></label>
          <label className="detail-field-short"><span>% apă</span><input inputMode="decimal" value={detail.waterPercentage ?? ''} onChange={(event) => updateQualityDetail(record.receptionId, detailType, { waterPercentage: event.target.value })} /></label>
          <label className="detail-field-short"><span>Prot</span><input inputMode="decimal" value={detail.proteinResult ?? ''} onChange={(event) => updateQualityDetail(record.receptionId, detailType, { proteinResult: event.target.value })} /></label>
          <label className="detail-field-tank"><span>Nr. tanc</span><select value={detail.tankNumber} onChange={(event) => updateQualityDetail(record.receptionId, detailType, { tankNumber: event.target.value })}><option value="">Tank no</option>{options.tanks.map((tank) => <option key={tank} value={tank}>{tank}</option>)}</select></label>
          <label className="detail-field-select"><span>Rezultat conformitate</span><select value={detail.conformityResult} onChange={(event) => updateQualityDetail(record.receptionId, detailType, { conformityResult: event.target.value })}><option value="">Select</option>{options.conformityResults.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label className="detail-field-datetime"><span>Data/ora intrare producție</span><input type="datetime-local" lang="en-GB" step="60" value={displayDateTimeInput(detail.productionEntryAt)} onChange={(event) => updateQualityDetail(record.receptionId, detailType, { productionEntryAt: storedDateTimeInput(event.target.value) })} /></label>
          <label className="detail-field-datetime"><span>Data/ora ieșire producție</span><input type="datetime-local" lang="en-GB" step="60" value={displayDateTimeInput(detail.productionExitAt)} onChange={(event) => updateQualityDetail(record.receptionId, detailType, { productionExitAt: storedDateTimeInput(event.target.value) })} /></label>
          <label className="detail-field-select"><span>Responsabil</span><input value={detail.responsiblePerson} onChange={(event) => updateQualityDetail(record.receptionId, detailType, { responsiblePerson: event.target.value })} /></label>
          <label className="wide"><span>Observații PCC1</span><textarea value={detail.pcc1Observations} onChange={(event) => updateQualityDetail(record.receptionId, detailType, { pcc1Observations: event.target.value })} /></label>
        </div>
      </details>
    )
  }

  function renderReconciliationSection(record: MilkReceptionRecord) {
    const reconciliation = record.reconciliation
    if (!reconciliation) return null
    return (
      <details
        className="detail-section-card reconciliation-detail-card"
        open={isDetailSectionOpen(record.receptionId, 'RECONCILIATION')}
        onToggle={(event) => updateDetailSectionOpen(record.receptionId, 'RECONCILIATION', event.currentTarget.open)}
      >
        <summary className="detail-section-summary">Daily aviz reconciliation</summary>
        <div className="reconciliation-detail-grid">
          <div>
            <span>Aviz liters</span>
            <strong>{formatNumber(reconciliation.avizLiters)}</strong>
          </div>
          <div>
            <span>Difference</span>
            <strong className={reconciliation.differenceLiters && Math.abs(reconciliation.differenceLiters) > 5 ? 'reconciliation-diff-warning' : ''}>{formatNumber(reconciliation.differenceLiters)}</strong>
          </div>
          <div>
            <span>Diff %</span>
            <strong className={reconciliation.differencePercent && Math.abs(reconciliation.differencePercent) > 0.25 ? 'reconciliation-diff-warning' : ''}>{reconciliation.differencePercent == null ? '-' : `${formatNumber(reconciliation.differencePercent, 2)}%`}</strong>
          </div>
          <div>
            <span>Matched rows</span>
            <strong>{reconciliation.matchedRowCount}</strong>
          </div>
          <div>
            <span>Suggested routes</span>
            <strong>{reconciliation.suggestedRoutes.length ? reconciliation.suggestedRoutes.join(', ') : '-'}</strong>
          </div>
        </div>
        {reconciliation.matchedRows.length > 0 && (
          <div className="reconciliation-match-list">
            {reconciliation.matchedRows.slice(0, 8).map((row, index) => (
              <span key={`${row.noticeNumber}-${row.rowNumber}-${index}`} title={row.sourceFile}>
                <b>{row.noticeNumber || `Line ${row.rowNumber ?? '-'}`}</b>
                <em>{row.center || '-'}</em>
                <strong>{formatNumber(row.liters)}</strong>
              </span>
            ))}
          </div>
        )}
      </details>
    )
  }

  function withCalculations(record: MilkReceptionRecord) {
    const full = numberValue(record.fullTruckWeightKg)
    const empty = numberValue(record.emptyTruckWeightKg)
    const density = numberValue(record.densityFactor)
    const dailyRoutesLiters = numberValue(record.dailyRoutesLiters)
    const net = full != null && empty != null && empty <= full ? full - empty : null
    const liters = net != null && density && density > 0 ? net / density : null
    return {
      ...record,
      qualityDetails: normalizeQualityDetails(record.qualityDetails),
      deliveryCategory: record.vehicleCategory === 'OTHER' ? 'OTHERS' : 'COLLECTION',
      netQuantityKg: net,
      calculatedLiters: liters,
      differenceLiters: liters != null && dailyRoutesLiters != null ? liters - dailyRoutesLiters : null,
      combinationDiagnosis: diagnose(record, full, empty, net),
    }
  }

  function diagnose(record: MilkReceptionRecord, full: number | null, empty: number | null, net: number | null) {
    if (!record.receptionDate || !record.vehicleRegistration || (record.vehicleCategory === 'COLLECTION' && !record.routeId) || !record.milkType) return 'Incomplete information'
    if (full == null || empty == null) return 'Incomplete information'
    if (empty > full) return 'Empty weight exceeds full weight'
    if (net === 0) return 'Zero kilograms'
    return 'OK'
  }

  function validate(record: MilkReceptionRecord) {
    const full = numberValue(record.fullTruckWeightKg)
    const empty = numberValue(record.emptyTruckWeightKg)
    if (!record.receptionDate) return 'Reception date is required.'
    if (!record.vehicleRegistration.trim()) return 'Truck number is required.'
    if (record.vehicleCategory === 'COLLECTION' && !record.routeId.trim()) return 'Route ID is required for collection trucks.'
    if (!record.milkType) return 'Milk type is required.'
    if (full == null || full <= 0) return 'Full truck weight must be a positive number.'
    if (empty == null || empty <= 0) return 'Empty truck weight must be a positive number.'
    if (empty > full) return 'Empty truck weight cannot exceed full truck weight.'
    return ''
  }

  return (
    <div className="app-shell reception-screen">
      <header className="app-topbar workflow-topbar reception-topbar">
        <div className="reception-topbar-left">
          <button className="back-button" type="button" onClick={onBack}>Back</button>
          <div>
            <p className="topbar-label">Factory workflow</p>
            <h1>Milk Reception</h1>
          </div>
        </div>
        <button className="reception-settings-tile" type="button" onClick={() => setSettingsOpen((open) => !open)}>
          <span>Settings</span>
          <strong>{options.vehicles.length} trucks</strong>
        </button>
      </header>

      <main className="reception-content">
        <section className="reception-toolbar">
          <label>
            <span>Reception date</span>
            <input type="date" lang="en-US" value={filterDate} onChange={(event) => setFilterDate(event.target.value)} />
          </label>
          <label>
            <span>Search</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Truck, route, milk type, status..." />
          </label>
          <button type="button" onClick={addRow}>Add reception row</button>
          <button type="button" className="secondary" onClick={() => void loadRecords()}>Refresh</button>
        </section>

        {settingsOpen && (
          <div className="reception-settings-overlay" role="dialog" aria-modal="true" aria-label="Truck and route settings">
            <section className="reception-settings-window">
              <div className="reception-settings-header">
                <div>
                  <p>Milk Reception settings</p>
                  <h2>{settingsTab === 'TRUCKS' ? 'Truck route register' : 'Driver register'}</h2>
                </div>
                <div className="reception-settings-header-actions">
                  {settingsTab === 'TRUCKS' ? (
                    <button className="secondary" type="button" onClick={() => void importRouteSettingsFromExcel()} disabled={Boolean(settingsBusy)}>
                      {settingsBusy === 'importing' ? 'Importing...' : 'Import from Excel'}
                    </button>
                  ) : (
                    <button className="secondary" type="button" onClick={() => void importDriversFromExcel()} disabled={Boolean(settingsBusy)}>
                      {settingsBusy === 'driver-importing' ? 'Importing...' : 'Import from Excel'}
                    </button>
                  )}
                  <button type="button" onClick={() => setSettingsOpen(false)} aria-label="Close settings">Close</button>
                </div>
              </div>

              <div className="reception-settings-tabs" aria-label="Milk reception settings sections">
                <button type="button" className={settingsTab === 'TRUCKS' ? 'active' : ''} onClick={() => setSettingsTab('TRUCKS')}>Truck routes</button>
                <button type="button" className={settingsTab === 'DRIVERS' ? 'active' : ''} onClick={() => setSettingsTab('DRIVERS')}>Drivers</button>
              </div>

              {settingsTab === 'TRUCKS' ? (
                <>
              <div className="reception-settings-intro">
                <p className="reception-settings-help">Each row is one truck. Enter available routes separated by commas, for example R08, R081, R082. Trucks with no routes can stay blank.</p>
                <div className="reception-settings-filter" aria-label="Filter truck settings by vehicle type">
                  <button type="button" className={settingsTypeFilter === 'ALL' ? 'active' : ''} onClick={() => setSettingsTypeFilter('ALL')}>All</button>
                  <button type="button" className={settingsTypeFilter === 'COLLECTION' ? 'active' : ''} onClick={() => setSettingsTypeFilter('COLLECTION')}>Collection</button>
                  <button type="button" className={settingsTypeFilter === 'OTHER' ? 'active' : ''} onClick={() => setSettingsTypeFilter('OTHER')}>Others</button>
                </div>
              </div>

              <div className="reception-settings-table-wrap">
                <table className="reception-settings-table">
                  <thead>
                    <tr>
                      <th>Truck ID</th>
                      <th>Vehicle type</th>
                      <th>Routes for this truck</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="reception-settings-new-row">
                      <td>
                        <input list="reception-truck-settings" value={newSettingsTruck} onChange={(event) => setNewSettingsTruck(event.target.value)} placeholder="Add truck ID" />
                        <datalist id="reception-truck-settings">
                          {truckOptions.map((truck) => <option key={truck.value} value={truck.value}>{truck.label}</option>)}
                        </datalist>
                      </td>
                      <td>
                        <select value={newSettingsCategory} onChange={(event) => setNewSettingsCategory(normalizeVehicleCategory(event.target.value))}>
                          {options.vehicleCategories.map((category) => <option key={category} value={category}>{vehicleCategoryLabel(category)}</option>)}
                        </select>
                      </td>
                      <td>
                        <input list="reception-route-settings" value={newSettingsRoutes} onChange={(event) => setNewSettingsRoutes(event.target.value)} placeholder="Optional: R01, R011, R012" />
                        <datalist id="reception-route-settings">
                          {knownRouteValues.map((route) => <option key={route} value={route} />)}
                        </datalist>
                      </td>
                      <td>
                        <button type="button" onClick={() => void saveTruckRoutes(newSettingsTruck, newSettingsRoutes, newSettingsCategory)} disabled={Boolean(settingsBusy)}>Add truck</button>
                      </td>
                    </tr>
                    {!visibleVehicleRoutes.length && (
                      <tr>
                        <td colSpan={4} className="reception-settings-empty">
                          {savedVehicleRoutes.length ? 'No trucks match this vehicle type filter.' : 'No truck settings saved yet. Import from Excel or add the first truck above.'}
                        </td>
                      </tr>
                    )}
                    {visibleVehicleRoutes.map((group) => (
                      <tr key={group.vehicle}>
                        <td className="reception-settings-truck">{group.vehicle}</td>
                        <td>
                          <select value={categoryDrafts[group.vehicle] ?? normalizeVehicleCategory(group.vehicleCategory)} onChange={(event) => setCategoryDrafts((current) => ({ ...current, [group.vehicle]: normalizeVehicleCategory(event.target.value) }))}>
                            {options.vehicleCategories.map((category) => <option key={category} value={category}>{vehicleCategoryLabel(category)}</option>)}
                          </select>
                        </td>
                        <td>
                          <input value={routeDrafts[group.vehicle] ?? group.routes.join(', ')} onChange={(event) => setRouteDrafts((current) => ({ ...current, [group.vehicle]: event.target.value }))} />
                        </td>
                        <td>
                          <div className="reception-settings-row-actions">
                            <button type="button" onClick={() => void saveTruckRoutes(group.vehicle, routeDrafts[group.vehicle] ?? group.routes.join(', '), categoryDrafts[group.vehicle] ?? normalizeVehicleCategory(group.vehicleCategory))} disabled={Boolean(settingsBusy)}>
                              {settingsBusy === group.vehicle ? 'Saving...' : 'Save'}
                            </button>
                            <button className="danger" type="button" onClick={() => void deleteTruckRoutes(group.vehicle)} disabled={Boolean(settingsBusy)}>
                              {settingsBusy === `delete-${group.vehicle}` ? 'Deleting...' : 'Delete'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
                </>
              ) : (
                <>
                  <p className="reception-settings-help">Add the driver names that should appear in the reception register dropdown.</p>
                  <div className="reception-settings-table-wrap">
                    <table className="reception-settings-table driver-settings-table">
                      <thead>
                        <tr>
                          <th>Driver name</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="reception-settings-new-row">
                          <td><input value={newDriverName} onChange={(event) => setNewDriverName(event.target.value)} placeholder="Add driver name" /></td>
                          <td><button type="button" onClick={() => void saveDriver()} disabled={Boolean(settingsBusy)}>{settingsBusy === 'driver-add' ? 'Saving...' : 'Add driver'}</button></td>
                        </tr>
                        {!options.driverSettings.length && (
                          <tr>
                            <td colSpan={2} className="reception-settings-empty">No driver names saved yet. Import from Excel or add the first driver above.</td>
                          </tr>
                        )}
                        {options.driverSettings.map((driver) => (
                          <tr key={driver.driverId}>
                            <td className="reception-settings-truck">{driver.driverName}</td>
                            <td>
                              <button className="danger" type="button" onClick={() => void deleteDriver(driver)} disabled={Boolean(settingsBusy)}>
                                {settingsBusy === `driver-delete-${driver.driverId}` ? 'Deleting...' : 'Delete'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          </div>
        )}

        {notice && <p className="reception-notice">{notice}</p>}
        {error && <p className="reception-error">{error}</p>}

        <section className="reception-table-panel">
          <div className="reception-table-heading">
            <div>
              <h2>Reception register</h2>
              <p>{loading ? 'Loading records...' : `${visibleRecords.length} rows shown`}</p>
            </div>
            <span>Excel-like entry</span>
          </div>

          <div className="reception-table-wrap">
            <table className="reception-table">
              <thead>
                <tr>
                  <th></th>
                  <th>ID</th>
                  <th>Date</th>
                  <th>Truck</th>
                  <th>Driver</th>
                  <th>Truck type</th>
                  <th>Route</th>
                  <th>Milk type</th>
                  <th>Full kg</th>
                  <th>Empty kg</th>
                  <th>Net kg</th>
                  <th>Liters</th>
                  <th>Aviz L</th>
                  <th>Diff L</th>
                  <th>Match</th>
                  <th>Comments</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {!visibleRecords.length && (
                  <tr>
                    <td colSpan={18} className="reception-empty">No reception records found. Add a row to start.</td>
                  </tr>
                )}
                {visibleRecords.map((record) => {
                  const computed = withCalculations(record)
                  const expanded = expandedId === record.receptionId
                  const filteredTruckOptions = truckOptionsForCategory(record.vehicleCategory)
                  return (
                    <Fragment key={record.receptionId}>
                      <tr className={statusClass(computed.combinationDiagnosis)}>
                        <td>
                          <button className="reception-expand" type="button" onClick={() => setExpandedId(expanded ? '' : record.receptionId)} aria-label={expanded ? 'Collapse row' : 'Expand row'}>
                            {expanded ? '-' : '+'}
                          </button>
                        </td>
                        <td className="reception-id" title={record.receptionId} aria-label={`Reception ID ${record.receptionId}`}>{compactReceptionId(record)}</td>
                        <td><input type="date" lang="en-US" value={record.receptionDate} onChange={(event) => updateRecord(record.receptionId, { receptionDate: event.target.value })} /></td>
                        <td>
                          <select value={record.vehicleRegistration} onChange={(event) => updateRecord(record.receptionId, { vehicleRegistration: event.target.value })}>
                            <option value="">Select truck</option>
                            {record.vehicleRegistration && !filteredTruckOptions.some((truck) => truck.value === record.vehicleRegistration) && <option value={record.vehicleRegistration}>{record.vehicleRegistration}</option>}
                            {filteredTruckOptions.map((truck) => <option key={truck.value} value={truck.value}>{truck.label}</option>)}
                          </select>
                        </td>
                        <td>
                          <select value={record.driverName} onChange={(event) => updateRecord(record.receptionId, { driverName: event.target.value })}>
                            <option value="">Driver</option>
                            {record.driverName && !driverOptions.includes(record.driverName) && <option value={record.driverName}>{record.driverName}</option>}
                            {driverOptions.map((driver) => <option key={driver} value={driver}>{driver}</option>)}
                          </select>
                        </td>
                        <td>
                          <select value={record.vehicleCategory} onChange={(event) => updateRecord(record.receptionId, { vehicleCategory: normalizeVehicleCategory(event.target.value) })}>
                            {options.vehicleCategories.map((category) => <option key={category} value={category}>{vehicleCategoryLabel(category)}</option>)}
                          </select>
                        </td>
                        <td>
                          <select value={record.routeId} onChange={(event) => updateRecord(record.receptionId, { routeId: event.target.value })} disabled={record.vehicleCategory === 'OTHER' && !routeOptionsForVehicle(record.vehicleRegistration).length}>
                            <option value="">{record.vehicleCategory === 'OTHER' && !routeOptionsForVehicle(record.vehicleRegistration).length ? 'No route' : 'Route'}</option>
                            {record.routeId && !routeOptionsForVehicle(record.vehicleRegistration).includes(record.routeId) && <option value={record.routeId}>{record.routeId}</option>}
                            {routeOptionsForVehicle(record.vehicleRegistration).map((route) => <option key={route} value={route}>{route}</option>)}
                          </select>
                        </td>
                        <td>
                          <select value={record.milkType} onChange={(event) => updateRecord(record.receptionId, { milkType: event.target.value })}>
                            {options.milkTypes.map((milk) => <option key={milk.code} value={milk.code}>{milk.label}</option>)}
                          </select>
                        </td>
                        <td><input inputMode="decimal" value={record.fullTruckWeightKg ?? ''} onChange={(event) => updateRecord(record.receptionId, { fullTruckWeightKg: event.target.value })} /></td>
                        <td><input inputMode="decimal" value={record.emptyTruckWeightKg ?? ''} onChange={(event) => updateRecord(record.receptionId, { emptyTruckWeightKg: event.target.value })} /></td>
                        <td className="readonly-number">{formatNumber(computed.netQuantityKg)}</td>
                        <td className="readonly-number">{formatNumber(computed.calculatedLiters)}</td>
                        <td className="readonly-number">{formatNumber(computed.reconciliation?.avizLiters ?? null)}</td>
                        <td className={`readonly-number ${computed.reconciliation?.differenceLiters && Math.abs(computed.reconciliation.differenceLiters) > 5 ? 'reconciliation-diff-warning' : ''}`}>{formatNumber(computed.reconciliation?.differenceLiters ?? null)}</td>
                        <td><span className={`reconciliation-status ${computed.reconciliation?.status || 'missing_info'}`}>{computed.reconciliation?.label || '-'}</span></td>
                        <td><input value={record.comments} onChange={(event) => updateRecord(record.receptionId, { comments: event.target.value })} placeholder="Comments" /></td>
                        <td><span className="reception-status">{computed.combinationDiagnosis}</span></td>
                        <td>
                          <div className="reception-actions">
                            <button type="button" onClick={() => void saveRecord(computed)} disabled={savingId === record.receptionId}>{savingId === record.receptionId ? 'Saving...' : 'Save'}</button>
                            <button type="button" className="danger" onClick={() => void deleteRecord(record)} disabled={savingId === record.receptionId}>Delete</button>
                          </div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="reception-detail-row">
                          <td colSpan={18}>
                            <div className="reception-details">
                              {renderReconciliationSection(computed)}
                              {renderQualitySection(record, 'ORIGINAL', 'Original values')}
                              {renderQualitySection(record, 'CUSTOM', 'Custom values')}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  )
}

function statusClass(status: string) {
  const lowered = status.toLowerCase()
  if (lowered === 'ok') return 'status-ok'
  if (lowered.includes('exceed') || lowered.includes('not found') || lowered.includes('problem')) return 'status-error'
  return 'status-warning'
}

function normalizeText(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, ' ')
    .trim()
}

function normalizeName(value: unknown) {
  return String(value || '').trim().replace(/\s+/gu, ' ')
}

function routesTextToArray(value: string) {
  const seen = new Set<string>()
  const routes: string[] = []
  for (const part of String(value || '').split(/[,;\n]+/u)) {
    const route = part.trim().toUpperCase()
    if (!route || seen.has(route)) continue
    seen.add(route)
    routes.push(route)
  }
  return routes
}

function normalizeVehicleCategory(value: unknown): VehicleCategory {
  const normalized = String(value || '').trim().toUpperCase()
  return normalized === 'OTHER' || normalized === 'OTHERS' ? 'OTHER' : 'COLLECTION'
}

function vehicleCategoryLabel(value: unknown) {
  return normalizeVehicleCategory(value) === 'OTHER' ? 'OTHERS' : 'COLLECTION'
}
