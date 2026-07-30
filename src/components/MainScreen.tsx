import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { ApiError } from '../api/client'
import { db } from '../db/database'
import { settingsStore } from '../store/settingsStore'
import { syncOfflineUsers } from '../sync/syncOfflineUsers'
import './MainScreen.css'

interface MainScreenProps {
  onSignIn: () => void
  onSettings: () => void
}

type SyncStatus = 'idle' | 'syncing' | 'done' | 'error'

export function MainScreen({ onSignIn, onSettings }: MainScreenProps) {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle')
  const [syncError, setSyncError] = useState('')
  const [userCount, setUserCount] = useState<number | null>(null)
  const [photoName, setPhotoName] = useState('')
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState('')
  const [cameraStatus, setCameraStatus] = useState('')
  const [isCameraOpen, setIsCameraOpen] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Refresh user count whenever a sync completes
  useEffect(() => {
    db.offlineUsers.count()
      .then(n => setUserCount(n))
      .catch(() => setUserCount(null))
  }, [syncStatus])

  // Auto-reset 'done' checkmark after 2 s
  useEffect(() => {
    if (syncStatus !== 'done') return
    const t = setTimeout(() => setSyncStatus('idle'), 2000)
    return () => clearTimeout(t)
  }, [syncStatus])

  useEffect(() => {
    return () => stopCamera()
  }, [])

  useEffect(() => {
    return () => {
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl)
    }
  }, [photoPreviewUrl])

  async function handleSync() {
    if (syncStatus === 'syncing') return

    const serverUrl = settingsStore.getServerUrl()
    if (!serverUrl) {
      setSyncStatus('error')
      setSyncError('No server URL configured. Open Settings first.')
      return
    }

    setSyncStatus('syncing')
    setSyncError('')
    abortRef.current = new AbortController()

    try {
      await syncOfflineUsers(abortRef.current.signal)
      setSyncStatus('done')
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setSyncStatus('error')
      if (err instanceof ApiError) {
        if (err.status === 401 || err.status === 403) {
          setSyncError(`Authentication failed (${err.status}). Check API credentials in Settings.`)
        } else if (err.status === 404) {
          setSyncError('Endpoint not found (404). Check the server URL in Settings.')
        } else {
          setSyncError(`Server error (${err.status}): ${err.message}`)
        }
      } else {
        const msg = (err as Error).message
        setSyncError(
          msg && !msg.toLowerCase().startsWith('failed to fetch')
            ? msg
            : 'Network error — could not reach the server. Check Settings.'
        )
      }
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setIsCameraOpen(false)
  }

  function handleFilePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl)

    setPhotoName(file ? file.name : '')
    setPhotoPreviewUrl(file ? URL.createObjectURL(file) : '')
  }

  async function openLiveCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus('Live camera is not supported in this browser.')
      return
    }

    try {
      setCameraStatus('Opening camera...')
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setIsCameraOpen(true)
      setCameraStatus('Live camera is active.')
    } catch (err) {
      setCameraStatus((err as Error).message || 'Could not open the camera.')
      stopCamera()
    }
  }

  const hasSyncedUsers = userCount !== null && userCount > 0

  return (
    <div className="main-screen">

      {/* ── Top-right action buttons ── */}
      <div className="main-top-actions">

        {/* Sync icon button */}
        <button
          className={`main-icon-btn${syncStatus === 'done' ? ' icon-btn-success' : ''}${syncStatus === 'error' ? ' icon-btn-error' : ''}`}
          type="button"
          onClick={handleSync}
          disabled={syncStatus === 'syncing'}
          aria-label="Sync users"
        >
          {syncStatus === 'done' ? (
            /* Checkmark */
            <svg viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          ) : (
            /* Sync arrows — spins while syncing */
            <svg viewBox="0 0 20 20" fill="currentColor" className={syncStatus === 'syncing' ? 'spin' : ''}>
              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
            </svg>
          )}
        </button>

        {/* Settings icon button */}
        <button className="main-icon-btn" type="button" onClick={onSettings} aria-label="Settings">
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* ── Hero ── */}
      <div className="main-hero">
        <div className="main-logo">
          <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M26 14h28v7l7 12v35a7 7 0 01-7 7H26a7 7 0 01-7-7V33l7-12V14z"
              fill="white" fillOpacity="0.15" stroke="white" strokeWidth="2.5" strokeLinejoin="round"
            />
            <path
              d="M31 14h18v7H31V14z"
              fill="white" fillOpacity="0.25" stroke="white" strokeWidth="2" strokeLinejoin="round"
            />
            <path
              d="M19 43h42v25a7 7 0 01-7 7H26a7 7 0 01-7-7V43z"
              fill="white" fillOpacity="0.92"
            />
            <path
              d="M19 43 Q26 38 33 43 Q40 48 47 43 Q54 38 61 43"
              fill="none" stroke="white" strokeWidth="2.5"
            />
          </svg>
        </div>

        <h1 className="main-title">MilkCollect</h1>
        <p className="main-tagline">Smart milk collection management</p>

        <div className="main-features">
          <span className="main-feature-chip">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 12.5a5.5 5.5 0 110-11 5.5 5.5 0 010 11zm.75-8.25a.75.75 0 00-1.5 0v3.5l2.25 2.25a.75.75 0 001.06-1.06L8.75 7.94V5.25z"/></svg>
            Offline ready
          </span>
          <span className="main-feature-chip">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 3A1.5 1.5 0 000 4.5v7A1.5 1.5 0 001.5 13h13a1.5 1.5 0 001.5-1.5v-7A1.5 1.5 0 0014.5 3h-13zm5 2h3a.5.5 0 010 1h-3a.5.5 0 010-1zm-3 0h1a.5.5 0 010 1h-1a.5.5 0 010-1zm7 0h1a.5.5 0 010 1h-1a.5.5 0 010-1zM2 7h1v1H2V7zm2 0h1v1H4V7zm2 0h1v1H6V7zm2 0h1v1H8V7zm2 0h1v1h-1V7zm2 0h1v1h-1V7zM2 9h1v1H2V9zm2 0h5v1H4V9zm6 0h2v1h-2V9z"/></svg>
            Barcode scan
          </span>
          <span className="main-feature-chip">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 100 16A8 8 0 008 0zM2.04 7.34A6.01 6.01 0 017.34 2.04v1.53a4.5 4.5 0 00-3.77 3.77H2.04zm0 1.32h1.53a4.5 4.5 0 003.77 3.77v1.53A6.01 6.01 0 012.04 8.66zm9.92-1.32h-1.53A4.5 4.5 0 006.66 3.57V2.04a6.01 6.01 0 015.3 5.3zm0 1.32A6.01 6.01 0 018.66 13.96v-1.53a4.5 4.5 0 003.77-3.77h1.53z"/></svg>
            Auto-sync
          </span>
        </div>

        <div className="main-photo-actions" aria-label="Mobile photo capture tests">
          <input
            ref={fileInputRef}
            className="main-photo-input"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFilePhotoChange}
          />
          <button
            className="main-photo-btn"
            type="button"
            onClick={() => fileInputRef.current?.click()}
          >
            <svg viewBox="0 0 20 20" fill="currentColor">
              <path d="M4 5a2 2 0 00-2 2v7a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-1.28a2 2 0 01-1.42-.59l-.71-.7A2 2 0 0011.17 3H8.83a2 2 0 00-1.42.59l-.71.7A2 2 0 015.28 5H4zm6 9a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm0-1.5a2 2 0 110-4 2 2 0 010 4z" />
            </svg>
            File input photo
          </button>
          <button
            className="main-photo-btn"
            type="button"
            onClick={isCameraOpen ? stopCamera : openLiveCamera}
          >
            <svg viewBox="0 0 20 20" fill="currentColor">
              <path d="M3.25 5A2.25 2.25 0 001 7.25v5.5A2.25 2.25 0 003.25 15h8.5A2.25 2.25 0 0014 12.75v-5.5A2.25 2.25 0 0011.75 5h-8.5zM16 7.7l2.26-1.3a.5.5 0 01.74.43v6.34a.5.5 0 01-.74.43L16 12.3V7.7z" />
            </svg>
            {isCameraOpen ? 'Stop live camera' : 'Live camera'}
          </button>
        </div>

        {(photoName || photoPreviewUrl || cameraStatus || isCameraOpen) && (
          <div className="main-photo-preview">
            {photoName && <span>Selected: {photoName}</span>}
            {photoPreviewUrl && (
              <img
                className="main-photo-image"
                src={photoPreviewUrl}
                alt="Selected preview"
              />
            )}
            {cameraStatus && <span>{cameraStatus}</span>}
            <video
              ref={videoRef}
              className={isCameraOpen ? 'main-camera-video active' : 'main-camera-video'}
              playsInline
              muted
            />
          </div>
        )}
      </div>

      {/* ── Bottom card ── */}
      <div className="main-bottom">

        {/* User sync status */}
        <div className="main-sync-status">
          {hasSyncedUsers ? (
            <span className="main-sync-ready">
              <svg viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm3.78 5.78a.75.75 0 00-1.06-1.06L7 9.44 5.28 7.72a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.06 0l4.25-4.25z"/>
              </svg>
              {userCount} {userCount === 1 ? 'user' : 'users'} ready for offline login
            </span>
          ) : (
            <span className="main-sync-hint">Tap the sync button above to enable offline login</span>
          )}
        </div>

        {syncStatus === 'error' && (
          <p className="main-sync-error">{syncError}</p>
        )}

        <button
          className="main-signin-btn"
          type="button"
          onClick={onSignIn}
          disabled={!hasSyncedUsers}
          title={hasSyncedUsers ? undefined : 'Sync users first'}
        >
          Sign in
        </button>

        <p className="main-version">MilkCollect v0.1.0</p>
      </div>
    </div>
  )
}
