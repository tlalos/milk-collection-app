import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import './OcrDocumentScreen.css'
import { OcrLanguageSwitch, useOcrLanguage } from './OcrLanguage'

interface OcrDocumentScreenProps {
  onBack: () => void
}

interface QueuedDocument {
  id: string
  file: File
  previewUrl: string
}

interface UploadedJob {
  id: string
  sourceFile: string
  status: 'queued'
  createdAt: string
}

interface UploadPayload {
  error?: string
  jobs?: UploadedJob[]
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function OcrDocumentScreen({ onBack }: OcrDocumentScreenProps) {
  const { language, setLanguage, isRo } = useOcrLanguage()
  const [documents, setDocuments] = useState<QueuedDocument[]>([])
  const [notice, setNotice] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [uploadedJobs, setUploadedJobs] = useState<UploadedJob[]>([])
  const documentsRef = useRef<QueuedDocument[]>([])
  const documentInputRef = useRef<HTMLInputElement | null>(null)
  const cameraInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    documentsRef.current = documents
  }, [documents])

  useEffect(() => () => {
    documentsRef.current.forEach((document) => URL.revokeObjectURL(document.previewUrl))
  }, [])

  function addFiles(files: FileList | null) {
    if (!files?.length) return

    const supportedFiles = Array.from(files).filter((file) =>
      file.type.startsWith('image/') || file.type === 'application/pdf',
    )
    const rejectedCount = files.length - supportedFiles.length

    setDocuments((current) => [
      ...current,
      ...supportedFiles.map((file) => ({
        id: makeId(),
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ])
    setNotice(rejectedCount ? (isRo ? `${rejectedCount} fișier${rejectedCount === 1 ? '' : 'e'} neacceptat${rejectedCount === 1 ? '' : 'e'} a fost omis.` : `${rejectedCount} unsupported file${rejectedCount === 1 ? '' : 's'} skipped.`) : '')
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    addFiles(event.target.files)
    event.target.value = ''
  }

  function removeDocument(id: string) {
    setDocuments((current) => {
      const removed = current.find((document) => document.id === id)
      if (removed) URL.revokeObjectURL(removed.previewUrl)
      return current.filter((document) => document.id !== id)
    })
  }

  function clearDocuments() {
    documents.forEach((document) => URL.revokeObjectURL(document.previewUrl))
    setDocuments([])
    setNotice('')
    setUploadedJobs([])
  }

  async function uploadDocuments() {
    if (!documents.length || isProcessing) return

    setIsProcessing(true)
    setNotice(isRo ? 'Documentele se încarcă în siguranță pe server…' : 'Uploading documents securely to the server…')
    setUploadedJobs([])

    const formData = new FormData()
    documents.forEach((document) => formData.append('documents', document.file, document.file.name))

    try {
      const response = await fetch('/api/ocr/jobs', { method: 'POST', body: formData })
      const responseText = await response.text()
      let payload: UploadPayload

      if (!responseText.trim()) {
        throw new Error(`OCR server returned an empty response (${response.status}). Open the app from the backend URL and try again.`)
      }

      try {
        payload = JSON.parse(responseText) as UploadPayload
      } catch {
        throw new Error(`OCR server returned an invalid response (${response.status}). Check that the frontend is connected to the OCR backend.`)
      }

      if (!response.ok) throw new Error(payload.error || `OCR request failed (${response.status}).`)
      const jobs = payload.jobs ?? []
      setUploadedJobs(jobs)
      documents.forEach((document) => URL.revokeObjectURL(document.previewUrl))
      setDocuments([])
      setNotice(isRo ? `${jobs.length} document${jobs.length === 1 ? '' : 'e'} încărcat${jobs.length === 1 ? '' : 'e'}. Puteți închide pagina; procesarea continuă pe server.` : `${jobs.length} document${jobs.length === 1 ? '' : 's'} uploaded. You may close this page; processing will continue on the server.`)
    } catch (error) {
      setNotice((error as Error).message || 'OCR extraction failed.')
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="ocr-screen">
      <header className="ocr-header">
        <button className="ocr-back" type="button" onClick={onBack} aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1>{isRo ? 'Document OCR' : 'OCR Document'}</h1>
          <p>{isRo ? 'Fotografiați sau selectați documente pentru extragerea datelor' : 'Capture or select documents to extract their data'}</p>
        </div>
        <OcrLanguageSwitch language={language} onChange={setLanguage} />
      </header>

      <main className="ocr-body">
        <section className="ocr-upload-card" aria-labelledby="ocr-add-title">
          <div className="ocr-upload-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M6 2h8l4 4v16H6z" />
              <path d="M14 2v5h5M9 14h6M12 11v6" />
            </svg>
          </div>
          <h2 id="ocr-add-title">{isRo ? 'Adăugați documente' : 'Add documents'}</h2>
          <p>{isRo ? 'Selectați imagini sau PDF-uri de pe dispozitiv ori fotografiați cu camera din spate a telefonului.' : "Select images or PDFs from this device, or take a photo using your phone's rear camera."}</p>

          <input
            ref={documentInputRef}
            className="ocr-hidden-input"
            type="file"
            accept="image/*,application/pdf"
            multiple
            onChange={handleInputChange}
          />
          <input
            ref={cameraInputRef}
            className="ocr-hidden-input"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleInputChange}
          />

          <div className="ocr-actions">
            <button className="ocr-action-button secondary" type="button" onClick={() => documentInputRef.current?.click()}>
              <svg viewBox="0 0 20 20" fill="currentColor"><path d="M3 4a2 2 0 012-2h4l2 2h4a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V4z" /></svg>
              {isRo ? 'Alegeți documente' : 'Choose documents'}
            </button>
            <button className="ocr-action-button primary" type="button" onClick={() => cameraInputRef.current?.click()}>
              <svg viewBox="0 0 20 20" fill="currentColor"><path d="M4 5a2 2 0 00-2 2v7a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-1.3l-1.4-2H8.7L7.3 5H4zm6 9a3.5 3.5 0 110-7 3.5 3.5 0 010 7z" /></svg>
              {isRo ? 'Fotografiați' : 'Take photo'}
            </button>
          </div>
        </section>

        <section className="ocr-queue" aria-labelledby="ocr-queue-title">
          <div className="ocr-queue-heading">
            <div>
              <h2 id="ocr-queue-title">{isRo ? 'Documente' : 'Documents'}</h2>
              <span>{documents.length} {isRo ? (documents.length === 1 ? 'document pregătit' : 'documente pregătite') : (documents.length === 1 ? 'document ready' : 'documents ready')}</span>
            </div>
            {documents.length > 0 && <button type="button" onClick={clearDocuments}>{isRo ? 'Ștergeți tot' : 'Clear all'}</button>}
          </div>

          {documents.length === 0 ? (
            <div className="ocr-empty-state">
              <span>{isRo ? 'Nu au fost adăugate documente' : 'No documents added yet'}</span>
              <small>{isRo ? 'Formate acceptate: JPG, PNG, WEBP și PDF' : 'Supported formats: JPG, PNG, WEBP and PDF'}</small>
            </div>
          ) : (
            <div className="ocr-document-list">
              {documents.map((document, index) => (
                <article className="ocr-document-row" key={document.id}>
                  {document.file.type.startsWith('image/') ? (
                    <img src={document.previewUrl} alt="" />
                  ) : (
                    <div className="ocr-pdf-preview" aria-hidden="true">PDF</div>
                  )}
                  <div className="ocr-document-info">
                    <strong>{document.file.name || `Camera photo ${index + 1}`}</strong>
                    <span>{formatFileSize(document.file.size)}</span>
                  </div>
                  <button type="button" onClick={() => removeDocument(document.id)} aria-label={`${isRo ? 'Eliminați' : 'Remove'} ${document.file.name}`}>
                    <svg viewBox="0 0 20 20" fill="currentColor"><path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="2" /></svg>
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>

        {notice && <p className="ocr-notice" role="status">{notice}</p>}

        <button className="ocr-process-button" type="button" disabled={documents.length === 0 || isProcessing} onClick={uploadDocuments}>
          {isProcessing ? (isRo ? 'Se încarcă documentele…' : 'Uploading documents…') : (isRo ? 'Încărcați documentele' : 'Upload documents')}
          <svg viewBox="0 0 20 20" fill="currentColor"><path d="M7 4l6 6-6 6" /></svg>
        </button>

        {uploadedJobs.length > 0 && (
          <section className="ocr-upload-success" aria-labelledby="ocr-uploaded-title">
            <h2 id="ocr-uploaded-title">{isRo ? 'Încărcare finalizată' : 'Upload complete'}</h2>
            <p>{isRo ? 'Serverul a pus documentele în coada de procesare OCR.' : 'The server has queued these documents for background OCR.'}</p>
            <ul>
              {uploadedJobs.map((job) => (
                <li key={job.id}>
                  <span aria-hidden="true">✓</span>
                  <div><strong>{job.sourceFile}</strong><small>{isRo ? 'În așteptarea procesării' : 'Queued for processing'}</small></div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  )
}
