import { useEffect, useMemo, useState } from 'react'
import { mockSuppliers } from '../data/mockSuppliers'
import { db } from '../db/database'
import type { Supplier, SupplierType } from '../types'
import { erpSupplierToSupplier } from '../types/suppliers'

interface SupplierSelectionScreenProps {
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
  successMessage,
  submittedCount,
  onBack,
  onSelectSupplier,
}: SupplierSelectionScreenProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [localSuppliers, setLocalSuppliers] = useState<Supplier[]>([])
  const [isLoadingSuppliers, setIsLoadingSuppliers] = useState(true)

  useEffect(() => {
    let isMounted = true

    db.suppliers
      .toArray()
      .then((suppliers) => {
        if (!isMounted) return
        setLocalSuppliers(suppliers.map(erpSupplierToSupplier))
      })
      .catch(() => {
        if (!isMounted) return
        setLocalSuppliers([])
      })
      .finally(() => {
        if (!isMounted) return
        setIsLoadingSuppliers(false)
      })

    return () => {
      isMounted = false
    }
  }, [])

  const suppliers = localSuppliers.length > 0 ? localSuppliers : mockSuppliers

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
          {isLoadingSuppliers && (
            <p className="supplier-list-note">Loading local suppliers...</p>
          )}

          {!isLoadingSuppliers && filteredSuppliers.map((supplier) => (
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

          {!isLoadingSuppliers && filteredSuppliers.length === 0 && (
            <p className="supplier-list-note">No suppliers found.</p>
          )}
        </div>
      </main>
    </div>
  )
}
