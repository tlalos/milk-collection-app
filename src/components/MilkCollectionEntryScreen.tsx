import { useState } from 'react'
import { milkTypes } from '../data/mockSuppliers'
import type { MilkEntry, MilkType, SubmittedCollection, Supplier, SupplierType } from '../types'

interface MilkCollectionEntryScreenProps {
  supplier: Supplier
  onBack: () => void
  onSubmit: (collection: SubmittedCollection) => void | Promise<void>
}

const defaultMilkTypes: MilkType[] = ['Cow milk', 'Sheep milk', 'Buffalo milk']

function createEntryId(milkType: MilkType | '') {
  if (milkType) return `default-${milkType.toLowerCase().replace(/\s+/g, '-')}`
  return globalThis.crypto?.randomUUID?.() ?? `entry-${Date.now()}-${Math.random()}`
}

function createMilkEntry(milkType: MilkType | '' = ''): MilkEntry {
  return {
    id: createEntryId(milkType),
    milkType,
    kg: '',
    waterPercentage: '',
    temperature: '',
    mobility: '',
    barcode: '',
  }
}

function supplierTypeClassName(type: SupplierType) {
  if (type === 'Regular VAT farmer') return 'regular'
  if (type === 'VAT-excluded farmer') return 'excluded'
  return 'cooperative'
}

function barcodePrefix(milkType: MilkType | '') {
  if (milkType === 'Goat milk') return 'GOAT'
  if (milkType === 'Sheep milk') return 'SHEEP'
  if (milkType === 'Cow milk') return 'COW'
  if (milkType === 'Buffalo milk') return 'BUFFALO'
  return 'MILK'
}

function createDefaultMilkEntries() {
  return defaultMilkTypes.map((milkType) => createMilkEntry(milkType))
}

function formatKg(kg: string) {
  return `${kg || '0.0'} kg`
}

export function MilkCollectionEntryScreen({
  supplier,
  onBack,
  onSubmit,
}: MilkCollectionEntryScreenProps) {
  const [entries, setEntries] = useState<MilkEntry[]>(createDefaultMilkEntries)
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>('default-cow-milk')

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
                    <span className="milk-entry-kg">{formatKg(entry.kg)}</span>
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
                  <label className="form-field">
                    <span>Milk type</span>
                    <select
                      value={entry.milkType}
                      onChange={(event) =>
                        updateEntry(entry.id, {
                          milkType: event.target.value as MilkType | '',
                        })
                      }
                    >
                      <option value="">Select milk type</option>
                      {milkTypes.map((milkType) => (
                        <option key={milkType} value={milkType}>
                          {milkType}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="form-field">
                    <span>Kg</span>
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
                    <span>Mobility</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="100"
                      step="0.1"
                      value={entry.mobility}
                      onChange={(event) =>
                        updateEntry(entry.id, { mobility: event.target.value })
                      }
                      placeholder="0.0"
                    />
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

                  <div className="barcode-value">
                    <span>Scanned value</span>
                    <strong>{entry.barcode || 'No scan yet'}</strong>
                  </div>
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
