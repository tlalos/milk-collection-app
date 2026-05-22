import { useState, useEffect } from 'react'
import { settingsStore } from '../store/settingsStore'
import { testConnection } from '../api/client'
import { db } from '../db/database'
import type { AppSettings } from '../types/settings'
import './SettingsScreen.css'

interface SettingsScreenProps {
  onBack: () => void
}

type TestStatus = 'idle' | 'testing' | 'ok' | 'fail'

const APP_VERSION = '0.1.0'

export function SettingsScreen({ onBack }: SettingsScreenProps) {
  const [settings, setSettings] = useState<AppSettings>(() => settingsStore.get())
  const [saved, setSaved] = useState(false)
  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [clearStatus, setClearStatus] = useState<'idle' | 'done'>('idle')

  // Reset "Saved" feedback after 2 s
  useEffect(() => {
    if (!saved) return
    const t = setTimeout(() => setSaved(false), 2000)
    return () => clearTimeout(t)
  }, [saved])

  function handleChange<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setSettings(prev => ({ ...prev, [key]: value }))
    setSaved(false)
    setTestStatus('idle')
  }

  function handleSave() {
    settingsStore.set(settings)
    setSaved(true)
  }

  async function handleTest() {
    if (testStatus === 'testing') return
    setTestStatus('testing')
    const ok = await testConnection(settings.serverUrl)
    setTestStatus(ok ? 'ok' : 'fail')
  }

  async function handleClearData() {
    if (!confirm('Clear all locally stored data? This cannot be undone.')) return
    await db.collections.clear()
    await db.farmers.clear()
    await db.syncLogs.clear()
    setClearStatus('done')
    setTimeout(() => setClearStatus('idle'), 2500)
  }

  return (
    <div className="settings-screen">
      {/* Header */}
      <header className="settings-header">
        <button className="settings-back" onClick={onBack} type="button" aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1>Settings</h1>
      </header>

      <div className="settings-body">

        {/* ── Connection ── */}
        <section className="settings-section">
          <h2 className="settings-section-title">Connection</h2>

          <div className="settings-field">
            <label htmlFor="serverUrl">Server URL</label>
            <div className="settings-url-row">
              <input
                id="serverUrl"
                type="url"
                inputMode="url"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="https://your-api-host/api"
                value={settings.serverUrl}
                onChange={e => handleChange('serverUrl', e.target.value)}
              />
              <button
                className={`settings-test-btn test-${testStatus}`}
                type="button"
                onClick={handleTest}
                disabled={testStatus === 'testing' || !settings.serverUrl}
              >
                {testStatus === 'testing' && <span className="settings-spinner" />}
                {testStatus === 'idle'    && 'Test'}
                {testStatus === 'ok'      && '✓ OK'}
                {testStatus === 'fail'    && '✗ Fail'}
              </button>
            </div>
            <p className="settings-hint">
              Base URL for all API calls, e.g. <em>https://myserver.com/api</em>
            </p>
          </div>

          <div className="settings-field">
            <label htmlFor="timeout">Request timeout (ms)</label>
            <input
              id="timeout"
              type="number"
              min={1000}
              max={60000}
              step={1000}
              value={settings.requestTimeoutMs}
              onChange={e => handleChange('requestTimeoutMs', Number(e.target.value))}
            />
          </div>
        </section>

        {/* ── App ── */}
        <section className="settings-section">
          <h2 className="settings-section-title">App</h2>

          <div className="settings-field">
            <label htmlFor="fiscalYear">Default fiscal year</label>
            <input
              id="fiscalYear"
              type="number"
              min={2000}
              max={2099}
              value={settings.defaultFiscalYear}
              onChange={e => handleChange('defaultFiscalYear', e.target.value)}
            />
            <p className="settings-hint">Used when logging in without selecting a year.</p>
          </div>
        </section>

        {/* ── Data ── */}
        <section className="settings-section">
          <h2 className="settings-section-title">Local data</h2>

          <button
            className="settings-danger-btn"
            type="button"
            onClick={handleClearData}
          >
            {clearStatus === 'done' ? '✓ Cleared' : 'Clear stored data'}
          </button>
          <p className="settings-hint" style={{ marginTop: 6 }}>
            Removes all collections, farmers, and sync logs from this device.
            Unsynced data will be lost.
          </p>
        </section>

        {/* ── About ── */}
        <section className="settings-section settings-about">
          <h2 className="settings-section-title">About</h2>
          <p>MilkCollect <span className="settings-version">v{APP_VERSION}</span></p>
          <p className="settings-hint">Offline-first milk collection PWA</p>
        </section>

      </div>

      {/* Sticky save bar */}
      <div className="settings-save-bar">
        <button
          className={`settings-save-btn ${saved ? 'saved' : ''}`}
          type="button"
          onClick={handleSave}
        >
          {saved ? '✓ Saved' : 'Save settings'}
        </button>
      </div>
    </div>
  )
}
