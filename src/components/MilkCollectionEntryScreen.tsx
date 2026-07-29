import { useEffect, useMemo, useState } from 'react'
import { milkTypes } from '../data/mockSuppliers'
import { db } from '../db/database'
import type { MilkEntry, MilkType, SubmittedCollection, Supplier, SupplierType } from '../types'
import type { LocalItem } from '../types/items'

interface MilkCollectionEntryScreenProps {
  supplier: Supplier
  onBack: () => void
  onSubmit: (collection: SubmittedCollection) => void | Promise<void>
}

const defaultMilkTypes: MilkType[] = ['Cow milk', 'Sheep milk', 'Buffalo milk']

interface MilkTypeOption {
  id: string
  itemId?: number
  label: string
  code: string
  measure: string
  offlineType: string
}

function createEntryId(milkType: MilkType | '') {
  if (milkType) return `default-${milkType.toLowerCase().replace(/\s+/g, '-')}`
  return globalThis.crypto?.randomUUID?.() ?? `entry-${Date.now()}-${Math.random()}`
}

function createMilkEntry(milkType: MilkType | '' = ''): MilkEntry {
  return {
    id: createEntryId(milkType),
    milkType,
    kg: '',
    fatPercentage: '',
    density: '',
    waterPercentage: '',
    temperature: '',
    ph: '',
    mobility: '',
    alcoholTest: '',
    antibioticsTest: '',
    siloTankNumber: '',
    entryTime: '',
    exitTime: '',
    barcode: '',
  }
}

function supplierTypeClassName(type: SupplierType) {
  if (type === 'Regular VAT farmer') return 'regular'
  if (type === 'VAT-excluded farmer') return 'excluded'
  return 'cooperative'
}

function barcodePrefix(milkType: MilkType | '') {
  const normalizedMilkType = normalize(milkType)
  if (normalizedMilkType.includes('goat')) return 'GOAT'
  if (normalizedMilkType.includes('sheep') || normalizedMilkType.includes('oaie')) return 'SHEEP'
  if (normalizedMilkType.includes('cow') || normalizedMilkType.includes('vaca')) return 'COW'
  if (normalizedMilkType.includes('buffalo') || normalizedMilkType.includes('bivol')) return 'BUFFALO'
  return 'MILK'
}

function createDefaultMilkEntries() {
  return defaultMilkTypes.map((milkType) => createMilkEntry(milkType))
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '')
}

function defaultMilkAliases(milkType: MilkType): string[] {
  if (milkType === 'Cow milk') return ['cowmilk', 'cow', 'laptedevaca', 'vaca']
  if (milkType === 'Sheep milk') return ['sheepmilk', 'sheep', 'laptedeoaie', 'oaie']
  if (milkType === 'Buffalo milk') return ['buffalomilk', 'buffalo', 'laptedebivol', 'bivol']
  return [normalize(milkType)]
}

function defaultMilkTypeForEntry(entry: MilkEntry): MilkType | undefined {
  return defaultMilkTypes.find((milkType) => entry.id === createEntryId(milkType))
}

function isNonMilkDairyItem(searchable: string) {
  return [
    'cheese',
    'telemea',
    'branza',
    'cascaval',
    'iaurt',
    'yogurt',
  ].some((keyword) => searchable.includes(keyword))
}

function scoreDefaultMilkOption(milkType: MilkType, option: MilkTypeOption) {
  const searchable = normalize(`${option.code} ${option.label}`)
  const aliases = defaultMilkAliases(milkType)
  const hasAnimalMatch = aliases.some((alias) => searchable.includes(alias))
  const hasMilkWord = searchable.includes('lapte') || searchable.includes('milk')

  if (!hasAnimalMatch) return -1

  let score = 0
  if (normalize(option.offlineType) === 'milkcollection') score += 20
  if (hasMilkWord) score += 40
  if (hasAnimalMatch && hasMilkWord) score += 40
  if (isNonMilkDairyItem(searchable)) score -= 100
  if (milkType === 'Cow milk' && normalize(option.code) === 'mf0010') score += 100

  return score
}

function findDefaultMilkOption(
  milkType: MilkType,
  options: MilkTypeOption[],
): MilkTypeOption | undefined {
  const milkCollectionOptions = options.filter(
    (option) => normalize(option.offlineType) === 'milkcollection',
  )
  const candidateGroups = milkCollectionOptions.length > 0
    ? [milkCollectionOptions, options]
    : [options]

  for (const candidates of candidateGroups) {
    const match = candidates
      .map((option) => ({ option, score: scoreDefaultMilkOption(milkType, option) }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.option

    if (match) return match
  }

  return undefined
}

function itemToMilkTypeOption(item: LocalItem): MilkTypeOption {
  return {
    id: String(item.item_id),
    itemId: item.item_id,
    label: item.item_descr,
    code: item.item_code,
    measure: item.item_mu1_shortcut,
    offlineType: item.item_offline_type,
  }
}

function fallbackMilkTypeOptions(): MilkTypeOption[] {
  return milkTypes.map((milkType) => ({
    id: milkType,
    label: milkType,
    code: '',
    measure: '',
    offlineType: '',
  }))
}

function formatItemLabel(option: Pick<MilkTypeOption, 'label' | 'code' | 'measure'>) {
  const itemLabel = option.code ? `${option.code} - ${option.label}` : option.label
  return option.measure ? `${itemLabel} (${option.measure})` : itemLabel
}

function formatSelectedItemLabel(option: Pick<MilkTypeOption, 'label' | 'measure'>) {
  return option.measure ? `${option.label} (${option.measure})` : option.label
}

function formatQuantity(quantity: string, measure?: string) {
  return `${quantity || '0.0'} ${measure || 'kg'}`
}

function MilkTypeSearchDropdown({
  value,
  itemCode,
  itemMeasure,
  options,
  onChange,
}: {
  value: MilkType | ''
  itemCode?: string
  itemMeasure?: string
  options: MilkTypeOption[]
  onChange: (option: MilkTypeOption | null) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    if (!normalizedQuery) return options

    return options.filter((option) => {
      const searchable = `${option.code} ${option.label} ${option.measure} ${option.offlineType}`.toLowerCase()
      return searchable.includes(normalizedQuery)
    })
  }, [options, query])

  function selectOption(option: MilkTypeOption) {
    onChange(option)
    setQuery('')
    setIsOpen(false)
  }

  const selectedLabel = value
    ? formatSelectedItemLabel({ label: value, measure: itemMeasure ?? '' })
    : 'Select item'

  return (
    <div className="form-field milk-type-field">
      <span>Milk type</span>
      <div className="milk-type-combobox">
        <button
          className="milk-type-select-button"
          type="button"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((current) => !current)}
        >
          <span className="milk-type-selected-text">
            <span>{selectedLabel}</span>
            {itemCode && <small>{itemCode}</small>}
          </span>
          <strong aria-hidden="true">{isOpen ? '-' : '+'}</strong>
        </button>

        {isOpen && (
          <div className="milk-type-menu">
            <input
              className="milk-type-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search item code or description"
              autoComplete="off"
            />

            <div className="milk-type-options" role="listbox">
              {filteredOptions.map((option) => (
                <button
                  className="milk-type-option"
                  key={option.id}
                  type="button"
                  onClick={() => selectOption(option)}
                >
                  <span>{option.code || 'No code'}</span>
                  <small>{option.measure ? `${option.label} - ${option.measure}` : option.label}</small>
                </button>
              ))}

              {filteredOptions.length === 0 && (
                <p className="milk-type-empty">No items found.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function MilkCollectionEntryScreen({
  supplier,
  onBack,
  onSubmit,
}: MilkCollectionEntryScreenProps) {
  const [entries, setEntries] = useState<MilkEntry[]>(createDefaultMilkEntries)
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>('default-cow-milk')
  const [syncedMilkOptions, setSyncedMilkOptions] = useState<MilkTypeOption[]>([])

  useEffect(() => {
    let isMounted = true

    db.items
      .toArray()
      .then((items) => {
        if (!isMounted) return

        const options = items
          .map(itemToMilkTypeOption)
          .filter((option) => option.label.trim() || option.code.trim())
          .sort((a, b) => {
            const aIsMilk = normalize(a.offlineType) === 'milkcollection'
            const bIsMilk = normalize(b.offlineType) === 'milkcollection'
            if (aIsMilk !== bIsMilk) return aIsMilk ? -1 : 1
            return formatItemLabel(a).localeCompare(formatItemLabel(b))
          })

        setSyncedMilkOptions(options)
      })
      .catch(() => {
        if (!isMounted) return
        setSyncedMilkOptions([])
      })

    return () => {
      isMounted = false
    }
  }, [])

  const milkTypeOptions = syncedMilkOptions.length > 0
    ? syncedMilkOptions
    : fallbackMilkTypeOptions()

  useEffect(() => {
    if (syncedMilkOptions.length === 0) return

    setEntries((current) => {
      let changed = false

      const nextEntries = current.map((entry) => {
        const defaultMilkType = defaultMilkTypeForEntry(entry)
        if (!defaultMilkType) {
          return entry
        }

        const option = findDefaultMilkOption(defaultMilkType, syncedMilkOptions)
        if (!option) return entry

        if (
          entry.itemId === option.itemId
          && entry.milkType === option.label
          && entry.itemCode === option.code
          && entry.itemMeasure === option.measure
        ) {
          return entry
        }

        changed = true
        return {
          ...entry,
          milkType: option.label,
          itemId: option.itemId,
          itemCode: option.code,
          itemDescription: option.label,
          itemMeasure: option.measure,
        }
      })

      return changed ? nextEntries : current
    })
  })

  function updateEntry(entryId: string, updates: Partial<MilkEntry>) {
    setEntries((current) =>
      current.map((entry) =>
        entry.id === entryId ? { ...entry, ...updates } : entry,
      ),
    )
  }

  function addEntry() {
    const entry = createMilkEntry()
    setEntries((current) => [...current, entry])
    setExpandedEntryId(entry.id)
  }

  function removeEntry(entryId: string) {
    setEntries((current) => {
      if (current.length === 1) return current

      const nextEntries = current.filter((entry) => entry.id !== entryId)
      setExpandedEntryId((currentExpandedId) =>
        currentExpandedId === entryId ? nextEntries[0]?.id ?? null : currentExpandedId,
      )
      return nextEntries
    })
  }

  function addMockBarcode(entryId: string, index: number) {
    const entry = entries.find((currentEntry) => currentEntry.id === entryId)
    const prefix = barcodePrefix(entry?.milkType ?? '')
    updateEntry(entryId, {
      barcode: `QR-${prefix}-${String(index + 1).padStart(3, '0')}`,
    })
  }

  async function submitForm() {
    await onSubmit({
      supplier,
      entries,
      submittedAt: new Date().toISOString(),
    })
    setEntries(createDefaultMilkEntries())
    setExpandedEntryId('default-cow-milk')
  }

  return (
    <div className="app-shell">
      <header className="app-topbar entry-topbar">
        <button className="back-button" type="button" onClick={onBack}>
          Back
        </button>
        <div>
          <p className="topbar-label">Milk collection</p>
          <h1>Collection entry</h1>
        </div>
      </header>

      <main className="screen-content entry-content">
        <section className="supplier-summary" aria-label="Selected supplier">
          <div>
            <p className="section-label">Supplier</p>
            <h2>{supplier.name}</h2>
          </div>
          <div className="supplier-meta">
            <span>{supplier.code}</span>
            <span className={`type-badge ${supplierTypeClassName(supplier.type)}`}>
              {supplier.type}
            </span>
          </div>
        </section>

        <section className="entry-section" aria-labelledby="milk-entry-title">
          <div className="entry-section-header">
            <h2 id="milk-entry-title">Milk entries</h2>
            <span className="entry-count">
              {entries.length} milk type{entries.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="milk-entry-list">
            {entries.map((entry, index) => (
              <article
                className={`milk-entry-card ${expandedEntryId === entry.id ? 'expanded' : 'collapsed'}`}
                key={entry.id}
              >
                <div className="milk-entry-header">
                  <button
                    className="milk-entry-toggle"
                    type="button"
                    aria-expanded={expandedEntryId === entry.id}
                    aria-controls={`milk-entry-details-${entry.id}`}
                    onClick={() =>
                      setExpandedEntryId((current) => current === entry.id ? null : entry.id)
                    }
                  >
                    <span className="milk-entry-title">
                      {entry.milkType || 'Select milk type'}
                    </span>
                    <span className="milk-entry-kg">{formatQuantity(entry.kg, entry.itemMeasure)}</span>
                    <span className="milk-entry-chevron" aria-hidden="true">
                      {expandedEntryId === entry.id ? '-' : '+'}
                    </span>
                  </button>
                  <button
                    className="remove-button"
                    type="button"
                    onClick={() => removeEntry(entry.id)}
                    disabled={entries.length === 1}
                  >
                    Remove
                  </button>
                </div>

                {expandedEntryId === entry.id && (
                <div className="entry-form-grid" id={`milk-entry-details-${entry.id}`}>
                  <MilkTypeSearchDropdown
                    value={entry.milkType}
                    itemCode={entry.itemCode}
                    itemMeasure={entry.itemMeasure}
                    options={milkTypeOptions}
                    onChange={(option) =>
                      updateEntry(entry.id, {
                        milkType: option?.label ?? '',
                        itemId: option?.itemId,
                        itemCode: option?.code,
                        itemDescription: option?.label,
                        itemMeasure: option?.measure,
                      })
                    }
                  />

                  <label className="form-field">
                    <span>Quantity{entry.itemMeasure ? ` (${entry.itemMeasure})` : ''}</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.1"
                      value={entry.kg}
                      onChange={(event) => updateEntry(entry.id, { kg: event.target.value })}
                      placeholder="0.0"
                    />
                  </label>

                  <label className="form-field">
                    <span>Fat %</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="100"
                      step="0.1"
                      value={entry.fatPercentage}
                      onChange={(event) =>
                        updateEntry(entry.id, { fatPercentage: event.target.value })
                      }
                      placeholder="0.0"
                    />
                  </label>

                  <label className="form-field">
                    <span>Density</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.001"
                      value={entry.density}
                      onChange={(event) =>
                        updateEntry(entry.id, { density: event.target.value })
                      }
                      placeholder="0.000"
                    />
                  </label>

                  <label className="form-field">
                    <span>Temperature °C</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      value={entry.temperature}
                      onChange={(event) =>
                        updateEntry(entry.id, { temperature: event.target.value })
                      }
                      placeholder="0.0"
                    />
                  </label>

                  <label className="form-field">
                    <span>Alcohol test</span>
                    <input
                      type="text"
                      value={entry.alcoholTest}
                      onChange={(event) =>
                        updateEntry(entry.id, { alcoholTest: event.target.value })
                      }
                      placeholder="Result"
                    />
                  </label>

                  <label className="form-field">
                    <span>Water %</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="100"
                      step="0.1"
                      value={entry.waterPercentage}
                      onChange={(event) =>
                        updateEntry(entry.id, { waterPercentage: event.target.value })
                      }
                      placeholder="0.0"
                    />
                  </label>

                  <label className="form-field">
                    <span>Silo / Tank number</span>
                    <select
                      value={entry.siloTankNumber}
                      onChange={(event) =>
                        updateEntry(entry.id, { siloTankNumber: event.target.value })
                      }
                    >
                      <option value="">Select tank</option>
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="3">3</option>
                      <option value="4">4</option>
                      <option value="5">5</option>
                      <option value="6">6</option>
                    </select>
                  </label>

                  <label className="form-field">
                    <span>Antibiotics test</span>
                    <select
                      value={entry.antibioticsTest}
                      onChange={(event) =>
                        updateEntry(entry.id, {
                          antibioticsTest: event.target.value as MilkEntry['antibioticsTest'],
                        })
                      }
                    >
                      <option value="">Select</option>
                      <option value="Yes">Yes</option>
                      <option value="No">No</option>
                    </select>
                  </label>

                  <div className="form-field scan-field">
                    <span>QR/barcode</span>
                    <button
                      className="scan-button"
                      type="button"
                      onClick={() => addMockBarcode(entry.id, index)}
                    >
                      Scan placeholder
                    </button>
                  </div>

                  <label className="form-field barcode-value">
                    <span>QR/barcode value</span>
                    <input
                      type="text"
                      value={entry.barcode}
                      onChange={(event) =>
                        updateEntry(entry.id, { barcode: event.target.value })
                      }
                      placeholder="Enter or scan value"
                      autoComplete="off"
                    />
                  </label>
                </div>
                )}
              </article>
            ))}
          </div>

          <button className="add-entry-button" type="button" onClick={addEntry}>
            <span aria-hidden="true">+</span>
            Add another milk type
          </button>

          <button className="submit-button" type="button" onClick={submitForm}>
            Submit Collection
          </button>
        </section>
      </main>
    </div>
  )
}
