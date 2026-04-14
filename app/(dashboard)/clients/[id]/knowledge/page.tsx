'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useLocale, formatLocalDate } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import MemoryStatusCard from '@/components/memory/MemoryStatusCard'
import MemoryGapsList from '@/components/memory/MemoryGapsList'
import MemoryAnswerDialog from '@/components/memory/MemoryAnswerDialog'
import MemoryViewer from '@/components/memory/MemoryViewer'
import type { ClientMemory, MemoryGap } from '@/lib/types/client'

interface ClientFile {
  id: string
  file_name: string
  file_type: string | null
  file_size: number | null
  storage_path: string
  description: string | null
  extraction_status: string | null
  migrated_to_knowledge_document_id: string | null
  created_at: string
}

interface KnowledgeDocument {
  id: string
  source_type: string
  source_name: string
  ingestion_status: string
  ingestion_error: string | null
  token_count: number | null
  metadata: Record<string, unknown> | null
  created_at: string
  processed_at: string | null
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getFileExtension(name: string): string {
  const ext = name.split('.').pop()?.toUpperCase()
  return ext || '?'
}

export default function ClientKnowledgePage() {
  const params = useParams()
  const clientId = params.id as string
  const supabase = createClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { t, locale } = useLocale()

  // Legacy client_files (kept read-only after phase 6)
  const [legacyFiles, setLegacyFiles] = useState<ClientFile[]>([])
  const [legacyLoading, setLegacyLoading] = useState(true)
  const [legacyOpen, setLegacyOpen] = useState(false)

  // Modern knowledge_documents
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [documentsLoading, setDocumentsLoading] = useState(true)

  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [migrating, setMigrating] = useState<Set<string>>(new Set())

  // Memory state
  const [memory, setMemory] = useState<ClientMemory | null>(null)
  const [memoryLoading, setMemoryLoading] = useState(true)
  const [activeGap, setActiveGap] = useState<MemoryGap | null>(null)
  const [showViewer, setShowViewer] = useState(false)

  // ───────── Loaders ─────────

  const loadLegacyFiles = useCallback(async () => {
    setLegacyLoading(true)
    try {
      const { data, error: err } = await supabase
        .from('client_files')
        .select('id, file_name, file_type, file_size, storage_path, description, extraction_status, migrated_to_knowledge_document_id, created_at')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })

      if (err) throw new Error(err.message)
      setLegacyFiles(data || [])
    } catch (err) {
      // Legacy table might be absent on some envs — degrade silently.
      console.error('[knowledge] legacy load failed:', err)
      setLegacyFiles([])
    }
    setLegacyLoading(false)
  }, [clientId, supabase])

  const loadDocuments = useCallback(async () => {
    setDocumentsLoading(true)
    try {
      const res = await fetch(`/api/knowledge/documents?clientId=${clientId}&limit=100`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || t('knowledge.errorLoading'))
      }
      const data = await res.json()
      setDocuments((data.documents || []) as KnowledgeDocument[])
    } catch (err) {
      console.error('[knowledge] documents load failed:', err)
      setDocuments([])
    }
    setDocumentsLoading(false)
  }, [clientId, t])

  const loadMemory = useCallback(async () => {
    setMemoryLoading(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/memory`)
      if (res.ok) {
        const data = await res.json()
        setMemory(data.memory)
      }
    } catch (err) {
      console.error('Failed to load memory:', err)
    }
    setMemoryLoading(false)
  }, [clientId])

  const handleMemoryRefresh = async () => {
    try {
      setMemory(prev => prev ? { ...prev, status: prev.status === 'empty' ? 'building' : 'refreshing' } as ClientMemory : null)

      const res = await fetch(`/api/clients/${clientId}/memory/refresh`, {
        method: 'POST',
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || t('knowledge.refreshFailed'))
      }

      await loadMemory()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('knowledge.memoryRefreshError'))
      await loadMemory()
    }
  }

  const handleGapAnswered = async () => {
    setActiveGap(null)
    await loadMemory()
  }

  useEffect(() => {
    loadLegacyFiles()
    loadDocuments()
    loadMemory()
  }, [loadLegacyFiles, loadDocuments, loadMemory])

  // Phase 5D: poll memory while status is transient.
  useEffect(() => {
    if (!memory) return
    if (memory.status !== 'building' && memory.status !== 'refreshing') return
    const interval = setInterval(loadMemory, 3000)
    return () => clearInterval(interval)
  }, [memory, loadMemory])

  // ───────── Upload (modern pipeline) ─────────

  async function handleUpload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    setUploading(true)
    setError(null)

    const results: string[] = []
    try {
      for (const file of Array.from(fileList)) {
        const form = new FormData()
        form.append('file', file)
        form.append('clientId', clientId)

        const res = await fetch('/api/knowledge/ingest', {
          method: 'POST',
          body: form,
        })

        const data = await res.json().catch(() => ({}))

        if (!res.ok || data.status === 'failed') {
          results.push(`${file.name}: ${data.error || `status ${res.status}`}`)
        } else {
          results.push(`${file.name}: ✓ ${data.chunkCount ?? '?'} chunks`)
        }

        // Activity log is already emitted server-side for ingest
      }

      if (results.some(r => !r.includes('✓'))) {
        setError(results.join(' · '))
      }

      await Promise.all([loadDocuments(), loadMemory()])
    } catch (err) {
      setError(err instanceof Error ? err.message : t('knowledge.uploadError'))
    }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ───────── Legacy file actions ─────────

  async function handleDownload(file: ClientFile) {
    try {
      const { data, error: err } = await supabase.storage
        .from('client-files')
        .createSignedUrl(file.storage_path, 60)

      if (err || !data?.signedUrl) throw new Error(t('knowledge.downloadError'))

      window.open(data.signedUrl, '_blank')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('knowledge.downloadError'))
    }
  }

  async function handleDeleteLegacy(file: ClientFile) {
    if (!window.confirm(t('knowledge.confirmDelete').replace('{name}', file.file_name))) return

    try {
      const { error: storageErr } = await supabase.storage
        .from('client-files')
        .remove([file.storage_path])

      if (storageErr) throw new Error(t('knowledge.storageError') + ': ' + storageErr.message)

      const { error: dbErr } = await supabase
        .from('client_files')
        .delete()
        .eq('id', file.id)

      if (dbErr) throw new Error(t('knowledge.dbError') + ': ' + dbErr.message)

      fetch('/api/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete_file',
          resource_type: 'file',
          resource_id: file.id,
          details: { file_name: file.file_name, client_id: clientId },
        }),
      }).catch(() => {})

      await loadLegacyFiles()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('knowledge.deleteError'))
    }
  }

  async function handleMigrateLegacy(file: ClientFile) {
    setError(null)
    setMigrating(prev => new Set(prev).add(file.id))
    try {
      const res = await fetch(
        `/api/clients/${clientId}/files/${file.id}/migrate-to-knowledge`,
        { method: 'POST' }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || `migrate failed (status ${res.status})`)
      }
      await Promise.all([loadLegacyFiles(), loadDocuments()])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Migrate failed')
    } finally {
      setMigrating(prev => {
        const next = new Set(prev)
        next.delete(file.id)
        return next
      })
    }
  }

  async function handleExtractAllLegacy() {
    setError(null)
    const res = await fetch(`/api/clients/${clientId}/files/extract-all`, { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error || 'extract-all failed')
      return
    }
    console.log('[extract-all]', data)
    alert(
      `Extract-all: ${data.succeeded} ok · ${data.failed} failed · ` +
      `${data.unsupported} unsupported · ${data.skipped} skipped`
    )
    await loadLegacyFiles()
  }

  async function handleMigrateAllLegacy() {
    setError(null)
    const pending = legacyFiles.filter(
      f => !f.migrated_to_knowledge_document_id && (f.extraction_status === 'completed' || f.extraction_status === 'unsupported')
    )
    if (pending.length === 0) {
      alert(t('knowledge.migrate_nothing_to_do'))
      return
    }
    if (!window.confirm(t('knowledge.migrate_all_confirm').replace('{count}', String(pending.length)))) return

    let ok = 0
    let failed = 0
    for (const f of pending) {
      setMigrating(prev => new Set(prev).add(f.id))
      try {
        const res = await fetch(
          `/api/clients/${clientId}/files/${f.id}/migrate-to-knowledge`,
          { method: 'POST' }
        )
        if (res.ok) ok++
        else failed++
      } catch {
        failed++
      } finally {
        setMigrating(prev => {
          const next = new Set(prev)
          next.delete(f.id)
          return next
        })
      }
    }
    alert(`Migrate: ${ok} ok · ${failed} failed`)
    await Promise.all([loadLegacyFiles(), loadDocuments()])
  }

  // ───────── Knowledge document actions ─────────

  async function handleDeleteDocument(doc: KnowledgeDocument) {
    if (!window.confirm(t('knowledge.confirmDelete').replace('{name}', doc.source_name))) return
    try {
      const res = await fetch(`/api/knowledge/documents/${doc.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `delete failed (status ${res.status})`)
      }
      await loadDocuments()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('knowledge.deleteError'))
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    handleUpload(e.dataTransfer.files)
  }

  // ───────── Derived counts ─────────

  const pendingLegacyCount = legacyFiles.filter(
    f => !f.migrated_to_knowledge_document_id && (f.extraction_status === 'completed' || f.extraction_status === 'unsupported')
  ).length
  const extractableLegacyCount = legacyFiles.filter(
    f => f.extraction_status !== 'completed' && f.extraction_status !== 'unsupported'
  ).length

  return (
    <div>
      {/* Memory Section */}
      {!memoryLoading && (
        <div className="flex flex-col gap-3 mb-6">
          <MemoryStatusCard
            status={memory?.status || 'empty'}
            completeness={memory?.completeness || 0}
            lastRefreshedAt={memory?.last_refreshed_at || null}
            errorMessage={memory?.error_message || null}
            factsCount={memory?.facts?.length || 0}
            gapsCount={memory?.gaps?.length || 0}
            onRefresh={handleMemoryRefresh}
            onViewMemory={() => setShowViewer(true)}
          />

          {memory?.status === 'ready' && memory.gaps.length > 0 && (
            <MemoryGapsList
              gaps={memory.gaps}
              onAnswerGap={(gap) => setActiveGap(gap)}
            />
          )}
        </div>
      )}

      {activeGap && (
        <MemoryAnswerDialog
          gap={activeGap}
          clientId={clientId}
          onClose={() => setActiveGap(null)}
          onAnswered={handleGapAnswered}
        />
      )}

      {showViewer && memory && memory.status === 'ready' && (
        <MemoryViewer
          memory={memory}
          onClose={() => setShowViewer(false)}
        />
      )}

      {/* Knowledge Base header */}
      <div className="flex justify-between items-start mb-5">
        <div>
          <h3 className="font-mono text-base font-bold text-foreground mb-1">
            {t('knowledge.title')}
          </h3>
          <p className="text-[13px] text-gray-500">
            {documents.length > 0
              ? <><span className="text-primary font-semibold">{documents.length}</span> {t('knowledge.documentsUploaded')}</>
              : t('knowledge.uploadPrompt')
            }
          </p>
        </div>
        <div className="flex gap-2 items-start">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className={cn(
              'px-4 py-2 rounded-lg border-none text-[13px] font-bold font-mono whitespace-nowrap',
              uploading
                ? 'bg-border text-gray-500 cursor-not-allowed'
                : 'bg-primary text-background cursor-pointer'
            )}
          >
            {uploading ? t('knowledge.uploading') : t('knowledge.uploadButton')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
          />
        </div>
      </div>

      {/* Drop Zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          'rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-all mb-5',
          dragOver ? 'border-primary bg-primary/[0.04]' : 'border-border'
        )}
      >
        <div className="text-[32px] mb-2">
          {uploading ? '...' : '\u25EB'}
        </div>
        <p className={cn('text-[13px]', dragOver ? 'text-primary' : 'text-gray-500')}>
          {uploading
            ? t('knowledge.uploadInProgress')
            : t('knowledge.dragDropText')
          }
        </p>
        <p className="text-[11px] text-gray-600 mt-1">
          {t('knowledge.anyFileMaxSize')}
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-3 bg-destructive/[0.08] border border-destructive/20 rounded-lg text-destructive text-[13px] mb-5">
          {error}
        </div>
      )}

      {/* Modern Knowledge Documents List */}
      {documentsLoading ? (
        <div className="text-gray-500 text-center py-[60px]">{t('common.loading')}</div>
      ) : documents.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center">
          <div className="text-[48px] mb-4">{'\u25EB'}</div>
          <h4 className="font-mono text-base font-semibold text-primary mb-2">
            {t('knowledge.noDocuments')}
          </h4>
          <p className="text-[13px] text-gray-500 max-w-[500px] mx-auto">
            {t('knowledge.noDocumentsDesc')}
          </p>
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border">
                {[t('knowledge.headerName'), t('knowledge.headerType'), t('knowledge.kb_status'), t('knowledge.kb_tokens'), t('knowledge.headerUploaded'), t('knowledge.headerActions')].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-[0.5px] font-mono">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => {
                const fromLegacy = typeof doc.metadata === 'object' && doc.metadata !== null && (doc.metadata as Record<string, unknown>).origin === 'legacy_client_files'
                return (
                  <tr key={doc.id} className="border-b border-[#1f2129]">
                    <td className="px-4 py-3 text-[#e0e0e0] text-[13px] max-w-[300px] overflow-hidden text-ellipsis whitespace-nowrap">
                      {doc.source_name}
                      {fromLegacy && (
                        <span className="ml-2 text-[10px] text-amber-500" title="Migrated from legacy client_files">
                          {'\u21BB'} legacy
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold font-mono bg-primary/10 text-primary">
                        {doc.source_type.replace('file_', '').toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[13px]">
                      {doc.ingestion_status === 'ready' && (
                        <span title={doc.ingestion_status} className="text-green-500">{'\u2713 ready'}</span>
                      )}
                      {doc.ingestion_status === 'failed' && (
                        <span title={doc.ingestion_error || 'failed'} className="text-destructive">{'\u2717 failed'}</span>
                      )}
                      {doc.ingestion_status !== 'ready' && doc.ingestion_status !== 'failed' && (
                        <span className="text-yellow-500">{'\u23F3'} {doc.ingestion_status}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-[13px]">
                      {doc.token_count ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-[13px]">
                      {formatLocalDate(new Date(doc.created_at), locale)}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleDeleteDocument(doc)}
                        className="px-2.5 py-1 bg-transparent border border-destructive/30 rounded-md text-destructive text-xs cursor-pointer"
                        title={t('knowledge.delete')}
                      >
                        {t('knowledge.delete')}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Legacy files — collapsible, only shown if any exist */}
      {!legacyLoading && legacyFiles.length > 0 && (
        <div className="mt-8">
          <button
            type="button"
            onClick={() => setLegacyOpen(o => !o)}
            className="w-full flex justify-between items-center px-4 py-3 bg-card border border-border rounded-lg text-left cursor-pointer hover:border-primary/40 transition-colors"
          >
            <div>
              <div className="font-mono text-[13px] font-bold text-foreground">
                {t('knowledge.legacy_title')} ({legacyFiles.length})
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {pendingLegacyCount > 0
                  ? <>{pendingLegacyCount} {t('knowledge.legacy_pending_migration')}</>
                  : t('knowledge.legacy_all_migrated')}
              </div>
            </div>
            <div className="text-muted-foreground text-[12px] font-mono">
              {legacyOpen ? '\u25B2' : '\u25BC'}
            </div>
          </button>

          {legacyOpen && (
            <div className="mt-3">
              <div className="flex gap-2 mb-3">
                {extractableLegacyCount > 0 && (
                  <button
                    type="button"
                    onClick={handleExtractAllLegacy}
                    className="px-3 py-1.5 rounded-md border border-primary/40 bg-primary/[0.08] text-primary text-[11px] font-bold font-mono cursor-pointer"
                    title={t('knowledge.legacy_extract_all_title')}
                  >
                    {'\u26A1'} {t('knowledge.legacy_extract_all')}
                  </button>
                )}
                {pendingLegacyCount > 0 && (
                  <button
                    type="button"
                    onClick={handleMigrateAllLegacy}
                    className="px-3 py-1.5 rounded-md border border-primary/40 bg-primary/[0.08] text-primary text-[11px] font-bold font-mono cursor-pointer"
                    title={t('knowledge.migrate_all_title')}
                  >
                    {'\u21BB'} {t('knowledge.migrate_all')}
                  </button>
                )}
              </div>

              <div className="bg-card rounded-xl border border-border overflow-hidden">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-border">
                      {[t('knowledge.headerName'), t('knowledge.headerType'), t('knowledge.headerAI'), t('knowledge.kb_migrated'), t('knowledge.headerSize'), t('knowledge.headerActions')].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-[0.5px] font-mono">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {legacyFiles.map((file) => {
                      const canMigrate =
                        !file.migrated_to_knowledge_document_id &&
                        (file.extraction_status === 'completed' || file.extraction_status === 'unsupported')
                      const isMigrating = migrating.has(file.id)
                      return (
                        <tr key={file.id} className="border-b border-[#1f2129]">
                          <td className="px-4 py-3 text-[#e0e0e0] text-[13px] max-w-[300px] overflow-hidden text-ellipsis whitespace-nowrap">
                            {file.file_name}
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold font-mono bg-muted/20 text-muted-foreground">
                              {getFileExtension(file.file_name)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-[13px]">
                            {file.extraction_status === 'completed' && (
                              <span title={t('knowledge.extractCompleted')} className="text-green-500">{'\u2713'}</span>
                            )}
                            {file.extraction_status === 'pending' && (
                              <span title={t('knowledge.extractPending')} className="text-yellow-500">{'\u23F3'}</span>
                            )}
                            {file.extraction_status === 'failed' && (
                              <span title={t('knowledge.extractFailed')} className="text-destructive">{'\u2717'}</span>
                            )}
                            {file.extraction_status === 'unsupported' && (
                              <span title={t('knowledge.extractUnsupported')} className="text-gray-500">{'\u2014'}</span>
                            )}
                            {!file.extraction_status && (
                              <span className="text-gray-500">{'\u2014'}</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-[13px]">
                            {file.migrated_to_knowledge_document_id ? (
                              <span className="text-primary font-mono text-[11px]">{'\u2713 ' + t('knowledge.kb_migrated_yes')}</span>
                            ) : (
                              <span className="text-amber-500 font-mono text-[11px]">{'\u2014'}</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-[13px]">
                            {formatFileSize(file.file_size)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleDownload(file)}
                                className="px-2.5 py-1 bg-transparent border border-border rounded-md text-primary text-xs cursor-pointer"
                                title={t('knowledge.download')}
                              >
                                {t('knowledge.download')}
                              </button>
                              {canMigrate && (
                                <button
                                  onClick={() => handleMigrateLegacy(file)}
                                  disabled={isMigrating}
                                  className={cn(
                                    'px-2.5 py-1 rounded-md text-xs cursor-pointer border',
                                    isMigrating
                                      ? 'bg-secondary text-muted-foreground border-border cursor-not-allowed'
                                      : 'bg-transparent border-primary/40 text-primary hover:bg-primary/[0.08]'
                                  )}
                                  title={t('knowledge.migrate_one_title')}
                                >
                                  {isMigrating ? '\u2026' : t('knowledge.migrate_one')}
                                </button>
                              )}
                              <button
                                onClick={() => handleDeleteLegacy(file)}
                                className="px-2.5 py-1 bg-transparent border border-destructive/30 rounded-md text-destructive text-xs cursor-pointer"
                                title={t('knowledge.delete')}
                              >
                                {t('knowledge.delete')}
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
