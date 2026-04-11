'use client'

import { useChat } from 'ai/react'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import ChatMessage from './ChatMessage'

interface ClientOption {
  id: string
  name: string
  domain: string | null
}

interface ChatInterfaceProps {
  clientId?: string
  clientName?: string
  mode: 'contextual' | 'assistant'
  clients?: ClientOption[]
}

export default function ChatInterface({ clientId: initialClientId, clientName: initialClientName, mode, clients }: ChatInterfaceProps) {
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [selectedClientId, setSelectedClientId] = useState<string | null>(initialClientId || null)
  const [selectedClientName, setSelectedClientName] = useState<string | null>(initialClientName || null)
  const [chatError, setChatError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()

  const activeClientId = mode === 'contextual' ? initialClientId : selectedClientId
  const activeClientName = mode === 'contextual' ? initialClientName : selectedClientName

  const { messages, input, handleInputChange, handleSubmit, isLoading, setMessages } = useChat({
    api: '/api/chat',
    body: {
      clientId: activeClientId || null,
      conversationId,
    },
    onFinish() {
      scrollToBottom()
    },
    onError(error) {
      console.error('[Ask J] Chat error:', error)
      setChatError(error.message || 'Errore nella comunicazione con il server')
    },
  })

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  function scrollToBottom() {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  // Create or load conversation on mount or client change
  useEffect(() => {
    initConversation()
  }, [activeClientId])

  async function initConversation() {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        console.error('[Ask J] No authenticated user')
        setChatError('Utente non autenticato. Ricarica la pagina.')
        setLoadingHistory(false)
        return
      }

      setLoadingHistory(true)

      let query = supabase
        .from('conversations')
        .select('id')
        .eq('user_id', user.id)
        .eq('mode', mode)
        .order('updated_at', { ascending: false })
        .limit(1)

      if (activeClientId) {
        query = query.eq('client_id', activeClientId)
      } else {
        query = query.is('client_id', null)
      }

      const { data: existing, error: queryError } = await query.single()

      if (queryError && queryError.code !== 'PGRST116') {
        // PGRST116 = "The result contains 0 rows" which is expected
        console.error('[Ask J] Conversation query error:', queryError)
      }

      if (existing) {
        setConversationId(existing.id)

        const { data: history } = await supabase
          .from('conversation_messages')
          .select('role, content')
          .eq('conversation_id', existing.id)
          .order('created_at', { ascending: true })
          .limit(50)

        if (history && history.length > 0) {
          setMessages(
            history.map((m, i) => ({
              id: `hist-${i}`,
              role: m.role as 'user' | 'assistant',
              content: m.content,
            }))
          )
        } else {
          setMessages([])
        }
      } else {
        const title = activeClientName ? `Chat con ${activeClientName}` : 'Ask J'
        const { data: newConv, error: insertError } = await supabase
          .from('conversations')
          .insert({
            user_id: user.id,
            client_id: activeClientId || null,
            title,
            mode,
          })
          .select('id')
          .single()

        if (insertError) {
          console.error('[Ask J] Failed to create conversation:', insertError)
          setChatError(`Errore creazione conversazione: ${insertError.message}`)
        } else if (newConv) {
          setConversationId(newConv.id)
          setMessages([])
        }
      }
    } catch (err) {
      console.error('[Ask J] initConversation error:', err)
      setChatError(`Errore inizializzazione: ${err instanceof Error ? err.message : String(err)}`)
    }

    setLoadingHistory(false)
  }

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return
    setChatError(null)

    if (conversationId) {
      try {
        await supabase.from('conversation_messages').insert({
          conversation_id: conversationId,
          role: 'user',
          content: input.trim(),
        })
      } catch (err) {
        console.error('[Ask J] Failed to save message:', err)
      }
    }

    handleSubmit(e)
  }

  const handleNewChat = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const title = activeClientName ? `Chat con ${activeClientName}` : 'Ask J'
    const { data: newConv } = await supabase
      .from('conversations')
      .insert({
        user_id: user.id,
        client_id: activeClientId || null,
        title,
        mode,
      })
      .select('id')
      .single()

    if (newConv) {
      setConversationId(newConv.id)
      setMessages([])
    }
  }

  const handleClientChange = (clientId: string) => {
    if (clientId === '') {
      setSelectedClientId(null)
      setSelectedClientName(null)
    } else {
      const client = clients?.find(c => c.id === clientId)
      setSelectedClientId(clientId)
      setSelectedClientName(client?.name || null)
    }
  }

  const suggestions = mode === 'contextual'
    ? [
      'Riassumi l\'ultima analisi',
      'Quali driver migliorare?',
      'Crea un brief SEO',
      'Analizza lo stack MarTech',
    ]
    : [
      'Come migliorare il Core Web Vitals?',
      'Best practice per GEO',
      'Confronta GA4 vs Matomo',
      'Checklist SEO tecnica',
    ]

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: 'calc(100vh - 220px)',
      background: '#111318',
      borderRadius: '12px',
      border: '1px solid #2a2d35',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 20px',
        borderBottom: '1px solid #2a2d35',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: '#1a1c24',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{
            width: 32,
            height: 32,
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(200, 230, 74, 0.1)',
            fontSize: '14px',
            fontWeight: 700,
            color: '#c8e64a',
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            J
          </span>
          <div>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '13px',
              fontWeight: 600,
              color: '#c8e64a',
            }}>
              Ask J
            </div>
            <div style={{ fontSize: '11px', color: '#6b7280' }}>
              {activeClientName
                ? `Contesto: ${activeClientName}`
                : 'Assistente SEO & Marketing'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {mode === 'assistant' && clients && clients.length > 0 && (
            <select
              value={selectedClientId || ''}
              onChange={(e) => handleClientChange(e.target.value)}
              style={{
                padding: '5px 10px',
                background: '#111318',
                border: '1px solid #2a2d35',
                borderRadius: '6px',
                color: '#a0a0a0',
                fontSize: '11px',
                fontFamily: "'JetBrains Mono', monospace",
                outline: 'none',
                cursor: 'pointer',
                maxWidth: '200px',
              }}
            >
              <option value="">Nessun cliente</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.domain ? ` (${c.domain})` : ''}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={handleNewChat}
            style={{
              padding: '5px 12px',
              background: '#2a2d35',
              border: 'none',
              borderRadius: '6px',
              color: '#a0a0a0',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            + Nuova Chat
          </button>
        </div>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '20px',
      }}>
        {loadingHistory ? (
          <div style={{ textAlign: 'center', color: '#6b7280', padding: '40px 0', fontSize: '13px' }}>
            Caricamento conversazione...
          </div>
        ) : messages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{
              width: 56,
              height: 56,
              borderRadius: '16px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(200, 230, 74, 0.08)',
              marginBottom: '16px',
              fontSize: '24px',
              fontWeight: 700,
              color: '#c8e64a',
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              J
            </div>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '14px',
              color: '#c8e64a',
              marginBottom: '8px',
            }}>
              {activeClientName
                ? `Chatta con Ask J su ${activeClientName}`
                : 'Chatta con Ask J'}
            </div>
            <p style={{ fontSize: '12px', color: '#6b7280', maxWidth: '400px', margin: '0 auto' }}>
              {activeClientName
                ? 'Posso analizzare i dati del cliente, suggerire azioni di miglioramento, creare report e brief strategici.'
                : 'Posso aiutarti con domande su SEO, digital marketing, strategie di crescita e best practice.'}
            </p>
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px',
              justifyContent: 'center',
              marginTop: '16px',
            }}>
              {suggestions.map(suggestion => (
                <button
                  key={suggestion}
                  onClick={async () => {
                    setChatError(null)
                    // Save to DB if conversation exists
                    if (conversationId) {
                      try {
                        await supabase.from('conversation_messages').insert({
                          conversation_id: conversationId,
                          role: 'user',
                          content: suggestion,
                        })
                      } catch (err) {
                        console.error('[Ask J] Failed to save suggestion:', err)
                      }
                    }
                    // Use append directly for suggestions
                    handleInputChange({ target: { value: suggestion } } as React.ChangeEvent<HTMLInputElement>)
                    setTimeout(() => {
                      const form = document.querySelector('form[data-chat-form]') as HTMLFormElement
                      if (form) form.requestSubmit()
                    }, 150)
                  }}
                  style={{
                    padding: '6px 12px',
                    background: '#1a1c24',
                    border: '1px solid #2a2d35',
                    borderRadius: '20px',
                    color: '#a0a0a0',
                    fontSize: '12px',
                    cursor: 'pointer',
                    transition: 'border-color 0.2s',
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <ChatMessage
              key={m.id}
              role={m.role as 'user' | 'assistant'}
              content={m.content}
            />
          ))
        )}

        {/* Error display */}
        {chatError && (
          <div style={{
            display: 'flex',
            justifyContent: 'flex-start',
            marginBottom: '12px',
          }}>
            <div style={{
              maxWidth: '80%',
              padding: '12px 16px',
              borderRadius: '16px 16px 16px 4px',
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              color: '#ef4444',
              fontSize: '13px',
            }}>
              <strong>Errore:</strong> {chatError}
              <button
                onClick={() => setChatError(null)}
                style={{
                  marginLeft: '8px',
                  background: 'none',
                  border: 'none',
                  color: '#ef4444',
                  cursor: 'pointer',
                  fontSize: '12px',
                  textDecoration: 'underline',
                }}
              >
                Chiudi
              </button>
            </div>
          </div>
        )}

        {isLoading && messages[messages.length - 1]?.role === 'user' && (
          <div style={{
            display: 'flex',
            justifyContent: 'flex-start',
            marginBottom: '12px',
          }}>
            <div style={{
              padding: '12px 16px',
              borderRadius: '16px 16px 16px 4px',
              background: '#1a1c24',
              border: '1px solid #2a2d35',
              color: '#6b7280',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}>
              <span style={{
                width: 20,
                height: 20,
                borderRadius: '4px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(200, 230, 74, 0.1)',
                fontSize: '10px',
                fontWeight: 700,
                color: '#c8e64a',
                fontFamily: "'JetBrains Mono', monospace",
              }}>J</span>
              <span style={{
                display: 'inline-block',
                animation: 'pulse 1.5s ease-in-out infinite',
              }}>
                Sto pensando...
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        data-chat-form
        onSubmit={handleFormSubmit}
        style={{
          padding: '16px 20px',
          borderTop: '1px solid #2a2d35',
          background: '#1a1c24',
          display: 'flex',
          gap: '10px',
        }}
      >
        <input
          value={input}
          onChange={handleInputChange}
          placeholder={
            activeClientName
              ? `Chiedi ad Ask J su ${activeClientName}...`
              : 'Chiedi qualcosa su SEO, marketing...'
          }
          disabled={isLoading || loadingHistory}
          style={{
            flex: 1,
            padding: '12px 16px',
            background: '#111318',
            border: '1px solid #2a2d35',
            borderRadius: '10px',
            color: '#ffffff',
            fontSize: '14px',
            outline: 'none',
          }}
          onFocus={e => (e.currentTarget.style.borderColor = '#c8e64a')}
          onBlur={e => (e.currentTarget.style.borderColor = '#2a2d35')}
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim() || loadingHistory}
          style={{
            padding: '12px 24px',
            background: isLoading || !input.trim() ? '#2a2d35' : '#c8e64a',
            color: isLoading || !input.trim() ? '#6b7280' : '#111318',
            border: 'none',
            borderRadius: '10px',
            fontWeight: 700,
            fontSize: '13px',
            fontFamily: "'JetBrains Mono', monospace",
            cursor: isLoading || !input.trim() ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s',
          }}
        >
          {isLoading ? '...' : 'Invia'}
        </button>
      </form>
    </div>
  )
}
