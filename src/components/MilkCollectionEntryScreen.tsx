import { useState } from 'react'
import { milkTypes } from '../data/mockSuppliers'
import type { MilkEntry, MilkType, SubmittedCollection, Supplier, SupplierType } from '../types'

interface MilkCollectionEntryScreenProps {
  supplier: Supplier
  onBack: () => void
  onSubmit: (collection: SubmittedCollection) => void
}

function createMilkEntry(): MilkEntry {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `entry-${Date.now()}-${Math.random()}`,
    milkType: '',
    kg: '',
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
  return 'MILK'
}

export function MilkCollectionEntryScreen({
  supplier,
  onBack,
  onSubmit,
}: MilkCollectionEntryScreenProps) {
  const [entries, setEntries] = useState<MilkEntry[]>(() => [createMilkEntry()])

  function updateEntry(entryId: string, updates: Partial<MilkEntry>) {
    setEntries((current) =>
      current.map((entry) =>
        entry.id === entryId ? { ...entry, ...updates } : entry,
      ),
    )
  }

  function addEntry() {
    setEntries((current) => [...current, createMilkEntry()])
  }

  function removeEntry(entryId: string) {
    setEntries((current) =>
      current.length === 1 ? current : current.filter((entry) => entry.id !== entryId),
    )
  }

  function addMockBarcode(entryId: string, index: number) {
    const entry = entries.find((currentEntry) => currentEntry.id === entryId)
    const prefix = barcodePrefix(entry?.milkType ?? '')
    updateEntry(entryId, {
      barcode: `QR-${prefix}-${String(index + 1).padStart(3, '0')}`,
    })
  }

  function submitForm() {
    onSubmit({
      supplier,
      entries,
      submittedAt: new Date().toISOString(),
    })
    setEntries([createMilkEntry()])
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
              <article className="milk-entry-card" key={entry.id}>
                <div className="milk-entry-header">
                  <h3>Milk Entry {index + 1}</h3>
                  <button
                    className="remove-button"
                    type="button"
                    onClick={() => removeEntry(entry.id)}
                    disabled={entries.length === 1}
                  >
                    Remove
                  </button>
                </div>

                <div className="entry-form-grid">
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
