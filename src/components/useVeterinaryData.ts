import { useEffect, useState } from 'react'
import { appPath } from '../ocrPaths'
import { type ApiaAvizApproval, type ApiaJournalGroup, type ApiaProducerReference } from '../apiaExport'
import { type VeterinaryHerdCount } from '../veterinaryExport'
import { loadOcrReferenceSuppliers } from '../store/ocrReferenceSuppliersStore'

export function useVeterinaryData() {
  const [groups, setGroups] = useState<ApiaJournalGroup[]>([])
  const [approvals, setApprovals] = useState<ApiaAvizApproval[]>([])
  const [references, setReferences] = useState<ApiaProducerReference[]>([])
  const [herdCounts, setHerdCounts] = useState<VeterinaryHerdCount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [canEdit, setCanEdit] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    async function load() {
      try {
        const response = await fetch(appPath('/api/ocr/exports/apia-rows'), { signal: controller.signal, cache: 'no-store' })
        const payload = await response.json() as { rows?: ApiaJournalGroup[]; avizApprovals?: ApiaAvizApproval[]; error?: string }
        if (!response.ok || !Array.isArray(payload.rows)) throw new Error(payload.error || 'Could not load producers.')
        const suppliers = await loadOcrReferenceSuppliers()
        const herdResponse = await fetch(appPath('/api/ocr/exports/producer-herd-counts'), { signal: controller.signal, cache: 'no-store' })
        const herdPayload = await herdResponse.json() as { counts?: VeterinaryHerdCount[]; error?: string; canEdit?: boolean }
        if (!herdResponse.ok || !Array.isArray(herdPayload.counts)) throw new Error(herdPayload.error || 'Could not load animal counts.')
        if (controller.signal.aborted) return
        setGroups(payload.rows)
        setApprovals(payload.avizApprovals || [])
        setReferences(suppliers.producers)
        setHerdCounts(herdPayload.counts)
        setCanEdit(herdPayload.canEdit === true)
      } catch (reason) {
        if (controller.signal.aborted) return
        setGroups([]); setApprovals([]); setReferences([]); setHerdCounts([])
        setError((reason as Error).message)
      } finally { if (!controller.signal.aborted) setLoading(false) }
    }
    void load()
    return () => controller.abort()
  }, [revision])
  return { groups, approvals, references, herdCounts, setHerdCounts, loading, error, canEdit, refresh: () => setRevision(value => value + 1) }
}
