import { useState, useEffect, useRef, useCallback } from 'react'
import { getCustomers } from '../api/customersApi'
import { ApiError } from '../api/client'
import type { FS_Customer } from '../types/customers'
import './CustomersScreen.css'

interface CustomersScreenProps {
  onBack: () => void
}

export function CustomersScreen({ onBack }: CustomersScreenProps) {
  const [search, setSearch] = useState('')
  const [customers, setCustomers] = useState<FS_Customer[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchCustomers = useCallback((q: string) => {
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setStatus('loading')
    setError(null)

    getCustomers(q, abortRef.current.signal)
      .then(data => {
        setCustomers(data)
        setStatus('idle')
      })
      .catch(err => {
        if ((err as Error).name === 'AbortError') return
        setStatus('error')
        if (err instanceof ApiError) {
          setError(err.status === 401
            ? 'Session expired. Please sign in again.'
            : `Error ${err.status}: ${err.message}`)
        } else {
          setError('Network error. Check your connection.')
        }
      })
  }, [])

  // Debounced search — fires 400 ms after the user stops typing
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchCustomers(search), 400)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search, fetchCustomers])

  // Initial load
  useEffect(() => {
    fetchCustomers('')
    return () => abortRef.current?.abort()
  }, [fetchCustomers])

  return (
    <div className="customers-screen">
      {/* Header */}
      <header className="customers-header">
        <button className="customers-back" onClick={onBack} type="button" aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1>Customers</h1>
        {status === 'loading' && <span className="customers-loader" />}
      </header>

      {/* Search bar */}
      <div className="customers-search-wrap">
        <div className="customers-search-box">
          <svg className="customers-search-icon" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M12.9 14.32a8 8 0 111.41-1.41l4.38 4.38-1.41 1.41-4.38-4.38zM8 14A6 6 0 108 2a6 6 0 000 12z" clipRule="evenodd" />
          </svg>
          <input
            className="customers-search-input"
            type="search"
            placeholder="Search by name, code or tax number…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          {search && (
            <button className="customers-clear" type="button" onClick={() => setSearch('')} aria-label="Clear">
              <svg viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="customers-body">
        {/* Error */}
        {status === 'error' && (
          <div className="customers-error">
            <p>{error}</p>
            <button type="button" onClick={() => fetchCustomers(search)}>Retry</button>
          </div>
        )}

        {/* Results count */}
        {status !== 'error' && customers.length > 0 && (
          <p className="customers-count">{customers.length} customer{customers.length !== 1 ? 's' : ''}</p>
        )}

        {/* List */}
        {customers.length > 0 && (
          <ul className="customers-list">
            {customers.map(c => (
              <li key={c.TRDR} className="customer-card">
                <div className="customer-avatar">
                  {(c.NAME || '?').charAt(0).toUpperCase()}
                </div>
                <div className="customer-info">
                  <span className="customer-name">{c.NAME}</span>
                  <span className="customer-meta">
                    {[c.CODE, c.AFM].filter(Boolean).join(' · ')}
                  </span>
                  {(c.CITY || c.ADDRESS) && (
                    <span className="customer-address">
                      {[c.ADDRESS, c.CITY].filter(Boolean).join(', ')}
                    </span>
                  )}
                  {(c.PHONE01 || c.EMAIL) && (
                    <span className="customer-contact">
                      {[c.PHONE01, c.EMAIL].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </div>
                <svg className="customer-chevron" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
              </li>
            ))}
          </ul>
        )}

        {/* Empty state */}
        {status !== 'loading' && status !== 'error' && customers.length === 0 && (
          <div className="customers-empty">
            <svg viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="24" r="20" stroke="#d1d5db" strokeWidth="2" />
              <path d="M16 28s2-4 8-4 8 4 8 4" stroke="#d1d5db" strokeWidth="2" strokeLinecap="round" />
              <circle cx="18" cy="21" r="2" fill="#d1d5db" />
              <circle cx="30" cy="21" r="2" fill="#d1d5db" />
            </svg>
            <p>{search ? `No customers found for "${search}"` : 'No customers found'}</p>
          </div>
        )}
      </div>
    </div>
  )
}
