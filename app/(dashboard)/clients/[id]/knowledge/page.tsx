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
  created_at: string
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

  const [files, setFiles] = useState<ClientFile[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Memory state
  const [memory, setMemory] = useState<ClientMemory | null>(null)
  const [memoryLoading, setMemoryLoading] = useState(true)
  const [activeGap, setActiveGap] = useState<MemoryGap | null>(null)
  const [showViewer, setShowViewer] = useState(false)

  const loadFiles = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: err } = await supabase
        .from('client_files')
        .select('id, file_name, file_type, file_size, storage_path, description, extraction_status, created_at')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })

      if (err) throw new Error(err.message)
      setFiles(data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : t('knowledge.errorLoading'))
    }
    setLoading(false)
  }, [clientId, supabase])

  // Load memory
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
      // Optimistic update
      setMemory(prev => prev ? { ...prev, status: prev.status === 'empty' ? 'building' : 'refreshing' } as ClientMemory : null)

      const res = await fetch(`/api/clients/${clientId}/memory/refresh`, {
        method: 'POST',
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || t('knowledge.refreshFailed'))
      }

      // Reload memory after refresh
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
    loadFiles()
    loadMemory()
  }, [loadFiles, loadMemory])

  async function handleUpload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    setUploading(true)
    setError(null)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error(t('knowledge.notAuthenticated'))

      for (const file of Array.from(fileList)) {
        const timestamp = Date.now()
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const storagePath = `${user.id}/${clientId}/${timestamp}_${safeName}`

        // Upload to Supabase Storage
        const { error: uploadErr } = await supabase.storage
          .from('client-files')
          .upload(storagePath, file)

        if (uploadErr) throw new Error(t('knowledge.uploadFailed') + ' ' + file.name + ': ' + uploadErr.message)

        // Insert metadata in DB
        const { data: insertedFile, error: insertErr } = await supabase
          .from('client_files')
          .insert({
            client_id: clientId,
            user_id: user.id,
            file_name: file.name,
            file_type: file.type || null,
            file_size: file.size,
            storage_path: storagePath,
            description: null,
            tags: null,
          })
          .select('id')
          .single()

        if (insertErr) throw new Error(t('knowledge.dbInsertFailed') + ': ' + insertErr.message)

        // Trigger text extraction (fire-and-forget)
        if (insertedFile) {
          fetch(`/api/clients/${clientId}/files/extract`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileId: insertedFile.id }),
          }).catch(() => {})
        }

        // Log activity (fire-and-forget)
        fetch('/api/activity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'upload_file',
            resource_type: 'file',
            details: { file_name: file.name, file_size: file.size, client_id: clientId },
          }),
        }).catch(() => {})
      }

      await loadFiles()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('knowledge.uploadError'))
    }
    setUploading(false)
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

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

  async function handleDelete(file: ClientFile) {
    if (!window.confirm(t('knowledge.confirmDelete').replace('{name}', file.file_name))) return

    try {
      // Delete from storage
      const { error: storageErr } = await supabase.storage
        .from('client-files')
        .remove([file.storage_path])

      if (storageErr) throw new Error(t('knowledge.storageError') + ': ' + storageErr.message)

      // Delete from DB
      const { error: dbErr } = await supabase
        .from('client_files')
        .delete()
        .eq('id', file.id)

      if (dbErr) throw new Error(t('knowledge.dbError') + ': ' + dbErr.message)

      // Log activity
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

      await loadFiles()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('knowledge.deleteError'))
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    handleUpload(e.dataTransfer.files)
  }

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

      {/* Answer Dialog */}
      {activeGap && (
        <MemoryAnswerDialog
          gap={activeGap}
          clientId={clientId}
          onClose={() => setActiveGap(null)}
          onAnswered={handleGapAnswered}
        />
      )}

      {/* Memory Viewer */}
      {showViewer && memory && memory.status === 'ready' && (
        <MemoryViewer
          memory={memory}
          onClose={() => setShowViewer(false)}
        />
      )}

      {/* Knowledge Base Header */}
      <div className="flex justify-between items-start mb-5">
        <div>
          <h3 className="font-mono text-base font-bold text-foreground mb-1">
            {t('knowledge.title')}
          </h3>
          <p className="text-[13px] text-gray-500">
            {files.length > 0
              ? <><span className="text-primary font-semibold">{files.length}</span> {t('knowledge.documentsUploaded')}</>
              : t('knowledge.uploadPrompt')
            }
          </p>
        </div>
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

      {/* File List */}
      {loading ? (
        <div className="text-gray-500 text-center py-[60px]">
          {t('common.loading')}
        </div>
      ) : files.length === 0 ? (
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
                {[t('knowledge.headerName'), t('knowledge.headerType'), t('knowledge.headerAI'), t('knowledge.headerSize'), t('knowledge.headerUploaded'), t('knowledge.headerActions')].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-[0.5px] font-mono">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.id} className="border-b border-[#1f2129]">
                  <td className="px-4 py-3 text-[#e0e0e0] text-[13px] max-w-[300px] overflow-hidden text-ellipsis whitespace-nowrap">
                    {file.file_name}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold font-mono bg-primary/10 text-primary">
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
                  <td className="px-4 py-3 text-gray-500 text-[13px]">
                    {formatFileSize(file.file_size)}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-[13px]">
                    {formatLocalDate(new Date(file.created_at), locale)}
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
                      <button
                        onClick={() => handleDelete(file)}
                        className="px-2.5 py-1 bg-transparent border border-destructive/30 rounded-md text-destructive text-xs cursor-pointer"
                        title={t('knowledge.delete')}
                      >
                        {t('knowledge.delete')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
