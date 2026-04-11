'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

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

  const [files, setFiles] = useState<ClientFile[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      setError(err instanceof Error ? err.message : 'Errore nel caricamento')
    }
    setLoading(false)
  }, [clientId, supabase])

  useEffect(() => {
    loadFiles()
  }, [loadFiles])

  async function handleUpload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    setUploading(true)
    setError(null)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Non autenticato')

      for (const file of Array.from(fileList)) {
        const timestamp = Date.now()
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const storagePath = `${user.id}/${clientId}/${timestamp}_${safeName}`

        // Upload to Supabase Storage
        const { error: uploadErr } = await supabase.storage
          .from('client-files')
          .upload(storagePath, file)

        if (uploadErr) throw new Error(`Upload fallito per ${file.name}: ${uploadErr.message}`)

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

        if (insertErr) throw new Error(`DB insert fallito: ${insertErr.message}`)

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
      setError(err instanceof Error ? err.message : 'Errore durante l\'upload')
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

      if (err || !data?.signedUrl) throw new Error('Impossibile creare URL di download')

      window.open(data.signedUrl, '_blank')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore download')
    }
  }

  async function handleDelete(file: ClientFile) {
    if (!window.confirm(`Eliminare "${file.file_name}"?`)) return

    try {
      // Delete from storage
      const { error: storageErr } = await supabase.storage
        .from('client-files')
        .remove([file.storage_path])

      if (storageErr) throw new Error(`Errore rimozione storage: ${storageErr.message}`)

      // Delete from DB
      const { error: dbErr } = await supabase
        .from('client_files')
        .delete()
        .eq('id', file.id)

      if (dbErr) throw new Error(`Errore rimozione DB: ${dbErr.message}`)

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
      setError(err instanceof Error ? err.message : 'Errore eliminazione')
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    handleUpload(e.dataTransfer.files)
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <h3 style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '16px',
            fontWeight: 700,
            color: '#ffffff',
            marginBottom: '4px',
          }}>
            Knowledge Base
          </h3>
          <p style={{ fontSize: '13px', color: '#6b7280' }}>
            {files.length > 0
              ? <><span style={{ color: '#c8e64a', fontWeight: 600 }}>{files.length}</span> documenti caricati</>
              : 'Carica documenti per costruire la knowledge base del cliente'
            }
          </p>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          style={{
            padding: '8px 16px',
            background: uploading ? '#2a2d35' : '#c8e64a',
            color: uploading ? '#6b7280' : '#111318',
            borderRadius: '8px',
            border: 'none',
            fontSize: '13px',
            fontWeight: 700,
            fontFamily: "'JetBrains Mono', monospace",
            cursor: uploading ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {uploading ? 'Caricando...' : 'Carica File'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => handleUpload(e.target.files)}
        />
      </div>

      {/* Drop Zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? '#c8e64a' : '#2a2d35'}`,
          borderRadius: '12px',
          padding: '32px',
          textAlign: 'center',
          marginBottom: '20px',
          cursor: 'pointer',
          transition: 'all 0.2s',
          background: dragOver ? 'rgba(200, 230, 74, 0.04)' : 'transparent',
        }}
      >
        <div style={{ fontSize: '32px', marginBottom: '8px' }}>
          {uploading ? '...' : '◫'}
        </div>
        <p style={{ fontSize: '13px', color: dragOver ? '#c8e64a' : '#6b7280' }}>
          {uploading
            ? 'Upload in corso...'
            : 'Trascina i file qui o clicca per selezionare'
          }
        </p>
        <p style={{ fontSize: '11px', color: '#4b5563', marginTop: '4px' }}>
          Qualsiasi tipo di file, max 50MB per file
        </p>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          padding: '12px 16px',
          background: 'rgba(239, 68, 68, 0.08)',
          border: '1px solid rgba(239, 68, 68, 0.2)',
          borderRadius: '8px',
          color: '#ef4444',
          fontSize: '13px',
          marginBottom: '20px',
        }}>
          {error}
        </div>
      )}

      {/* File List */}
      {loading ? (
        <div style={{ color: '#6b7280', textAlign: 'center', padding: '60px 0' }}>
          Caricamento...
        </div>
      ) : files.length === 0 ? (
        <div style={{
          background: '#1a1c24',
          borderRadius: '12px',
          border: '1px solid #2a2d35',
          padding: '48px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>◫</div>
          <h4 style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '16px',
            fontWeight: 600,
            color: '#c8e64a',
            marginBottom: '8px',
          }}>
            Nessun Documento
          </h4>
          <p style={{
            fontSize: '13px',
            color: '#6b7280',
            maxWidth: '500px',
            margin: '0 auto',
          }}>
            Carica report, documenti, presentazioni o qualsiasi file per costruire la knowledge base di questo cliente. Questi file verranno utilizzati come contesto per le analisi AI.
          </p>
        </div>
      ) : (
        <div style={{
          background: '#1a1c24',
          borderRadius: '12px',
          border: '1px solid #2a2d35',
          overflow: 'hidden',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2a2d35' }}>
                {['Nome', 'Tipo', 'AI', 'Dimensione', 'Caricato il', 'Azioni'].map(h => (
                  <th key={h} style={{
                    padding: '12px 16px',
                    textAlign: 'left',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: '#6b7280',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    fontFamily: "'JetBrains Mono', monospace",
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.id} style={{ borderBottom: '1px solid #1f2129' }}>
                  <td style={{ padding: '12px 16px', color: '#e0e0e0', fontSize: '13px', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {file.file_name}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 600,
                      fontFamily: "'JetBrains Mono', monospace",
                      background: 'rgba(200, 230, 74, 0.1)',
                      color: '#c8e64a',
                    }}>
                      {getFileExtension(file.file_name)}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: '13px' }}>
                    {file.extraction_status === 'completed' && (
                      <span title="Testo estratto per AI" style={{ color: '#22c55e' }}>✓</span>
                    )}
                    {file.extraction_status === 'pending' && (
                      <span title="Estrazione in corso" style={{ color: '#eab308' }}>⏳</span>
                    )}
                    {file.extraction_status === 'failed' && (
                      <span title="Estrazione fallita" style={{ color: '#ef4444' }}>✗</span>
                    )}
                    {file.extraction_status === 'unsupported' && (
                      <span title="Tipo non supportato" style={{ color: '#6b7280' }}>—</span>
                    )}
                    {!file.extraction_status && (
                      <span style={{ color: '#6b7280' }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px', color: '#6b7280', fontSize: '13px' }}>
                    {formatFileSize(file.file_size)}
                  </td>
                  <td style={{ padding: '12px 16px', color: '#6b7280', fontSize: '13px' }}>
                    {new Date(file.created_at).toLocaleDateString('it-IT', {
                      day: '2-digit', month: 'short', year: 'numeric',
                    })}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => handleDownload(file)}
                        style={{
                          padding: '4px 10px',
                          background: 'transparent',
                          border: '1px solid #2a2d35',
                          borderRadius: '6px',
                          color: '#c8e64a',
                          fontSize: '12px',
                          cursor: 'pointer',
                        }}
                        title="Download"
                      >
                        Download
                      </button>
                      <button
                        onClick={() => handleDelete(file)}
                        style={{
                          padding: '4px 10px',
                          background: 'transparent',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          borderRadius: '6px',
                          color: '#ef4444',
                          fontSize: '12px',
                          cursor: 'pointer',
                        }}
                        title="Elimina"
                      >
                        Elimina
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
