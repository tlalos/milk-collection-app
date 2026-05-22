import { useMemo, useState } from 'react'
import type { Supplier, SupplierType } from '../types'

interface SupplierSelectionScreenProps {
  suppliers: Supplier[]
  successMessage: string
  submittedCount: number
  onBack: () => void
  onSelectSupplier: (supplier: Supplier) => void
}

function typeClassName(type: SupplierType) {
  if (type === 'Regular VAT farmer') return 'regular'
  if (type === 'VAT-excluded farmer') return 'excluded'
  return 'cooperative'
}

export function SupplierSelectionScreen({
  suppliers,
  successMessage,
  submittedCount,
  onBack,
  onSelectSupplier,
}: SupplierSelectionScreenProps) {
  const [searchTerm, setSearchTerm] = useState('')

  const filteredSuppliers = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase()

    if (!normalizedSearch) {
      return suppliers
    }

    return suppliers.filter((supplier) => {
      const searchableText = `${supplier.name} ${supplier.code} ${supplier.type}`.toLowerCase()
      return searchableText.includes(normalizedSearch)
    })
  }, [searchTerm, suppliers])

  return (
    <div className="app-shell">
      <header className="app-topbar workflow-topbar">
        <button className="back-button" type="button" onClick={onBack}>
          Back
        </button>
        <div>
          <p className="topbar-label">Milk collection</p>
          <h1>MilkCollect</h1>
        </div>
        <span className="offline-badge">Offline ready</span>
      </header>

      <main className="screen-content supplier-content">
        {successMessage && (
          <div className="success-banner" role="status">
            <span>{successMessage}</span>
            <strong>{submittedCount}</strong>
          </div>
        )}

        <section className="screen-heading" aria-labelledby="supplier-selection-title">
          <p className="section-label">Supplier selection</p>
          <h2 id="supplier-selection-title">Select supplier</h2>
        </section>

        <label className="search-field" htmlFor="supplier-search">
          <span>Search</span>
          <input
            id="supplier-search"
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Name, code, or supplier type"
          />
        </label>

        <div className="supplier-list" role="list">
          {filteredSuppliers.map((supplier) => (
            <div key={supplier.id} role="listitem">
              <button
                className="supplier-card"
                type="button"
                onClick={() => onSelectSupplier(supplier)}
              >
                <span className="supplier-main">
                  <strong>{supplier.name}</strong>
                  <span>{supplier.code}</span>
                </span>
                <span className={`type-badge ${typeClassName(supplier.type)}`}>
                  {supplier.type}
                </span>
              </button>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
