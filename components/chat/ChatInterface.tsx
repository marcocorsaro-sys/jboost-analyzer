'use client'

import { useChat } from 'ai/react'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useLocale } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import ChatMessage from './ChatMessage'
import type { MemoryGap } from '@/lib/types/client'

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
  const { t } = useLocale()
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [selectedClientId, setSelectedClientId] = useState<string | null>(initialClientId || null)
  const [selectedClientName, setSelectedClientName] = useState<string | null>(initialClientName || null)
  const [chatError, setChatError] = useState<string | null>(null)
  const [memoryGaps, setMemoryGaps] = useState<MemoryGap[]>([])
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
      setChatError(error.message || t('chat.serverError'))
    },
  })

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  function scrollToBottom() {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  // Load memory gaps for contextual mode
  useEffect(() => {
    if (activeClientId && mode === 'contextual') {
      fetch(`/api/clients/${activeClientId}/memory`)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data?.memory?.gaps) {
            // Top 3 high/medium gaps
            const sorted = [...data.memory.gaps]
              .filter((g: MemoryGap) => g.importance !== 'low')
              .sort((a: MemoryGap, b: MemoryGap) => {
                const order = { high: 0, medium: 1, low: 2 }
                return (order[a.importance] ?? 2) - (order[b.importance] ?? 2)
              })
              .slice(0, 3)
            setMemoryGaps(sorted)
          } else {
            setMemoryGaps([])
          }
        })
        .catch(() => setMemoryGaps([]))
    } else {
      setMemoryGaps([])
    }
  }, [activeClientId, mode])

  // Create or load conversation on mount or client change
  useEffect(() => {
    initConversation()
  }, [activeClientId])

  async function initConversation() {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        console.error('[Ask J] No authenticated user')
        setChatError(t('chat.authError'))
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
        const title = activeClientName ? `${t('chat.chatWith')} ${activeClientName}` : 'Ask J'
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
          setChatError(`${t('chat.conversationError')}: ${insertError.message}`)
        } else if (newConv) {
          setConversationId(newConv.id)
          setMessages([])
        }
      }
    } catch (err) {
      console.error('[Ask J] initConversation error:', err)
      setChatError(`${t('chat.initError')}: ${err instanceof Error ? err.message : String(err)}`)
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

    const title = activeClientName ? `${t('chat.chatWith')} ${activeClientName}` : 'Ask J'
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
      t('chat.sugContextual1'),
      t('chat.sugContextual2'),
      t('chat.sugContextual3'),
      t('chat.sugContextual4'),
    ]
    : [
      t('chat.sugAssistant1'),
      t('chat.sugAssistant2'),
      t('chat.sugAssistant3'),
      t('chat.sugAssistant4'),
    ]

  const isSubmitDisabled = isLoading || !input.trim() || loadingHistory

  return (
    <div className="flex flex-col h-[calc(100vh-220px)] bg-background rounded-xl border border-border overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-border flex justify-between items-center bg-card">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center bg-primary/10 text-sm font-bold text-primary font-mono">
            J
          </span>
          <div>
            <div className="font-mono text-[13px] font-semibold text-primary">
              Ask J
            </div>
            <div className="text-[11px] text-muted-foreground">
              {activeClientName
                ? `${t('chat.context')}: ${activeClientName}`
                : t('chat.seoAssistant')}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {mode === 'assistant' && clients && clients.length > 0 && (
            <select
              value={selectedClientId || ''}
              onChange={(e) => handleClientChange(e.target.value)}
              className="px-2.5 py-1.5 bg-background border border-border rounded-md text-muted-foreground text-[11px] font-mono outline-none cursor-pointer max-w-[200px]"
            >
              <option value="">{t('chat.noClient')}</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.domain ? ` (${c.domain})` : ''}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={handleNewChat}
            className="px-3 py-1.5 bg-secondary border-none rounded-md text-muted-foreground text-[11px] font-semibold cursor-pointer font-mono hover:bg-secondary/80 transition-colors"
          >
            {t('chat.newChat')}
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-5">
        {loadingHistory ? (
          <div className="text-center text-muted-foreground py-10 text-[13px]">
            {t('chat.loadingConversation')}
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-10">
            <div className="w-14 h-14 rounded-2xl inline-flex items-center justify-center bg-primary/[0.08] mb-4 text-2xl font-bold text-primary font-mono">
              J
            </div>
            <div className="font-mono text-sm text-primary mb-2">
              {activeClientName
                ? `${t('chat.chatWithAbout')} ${activeClientName}`
                : t('chat.chatWith')}
            </div>
            <p className="text-xs text-muted-foreground max-w-[400px] mx-auto">
              {activeClientName
                ? t('chat.contextualHelp')
                : t('chat.assistantHelp')}
            </p>
            <div className="flex flex-wrap gap-1.5 justify-center mt-4">
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
                  className="px-3 py-1.5 bg-card border border-border rounded-full text-muted-foreground text-xs cursor-pointer transition-colors hover:border-primary"
                >
                  {suggestion}
                </button>
              ))}
            </div>

            {/* Memory Gap Suggestions */}
            {memoryGaps.length > 0 && (
              <div className="mt-4">
                <div className="text-[11px] text-muted-foreground mb-2 font-mono">
                  {t('memory.completeClientMemory')}:
                </div>
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {memoryGaps.map(gap => (
                    <button
                      key={gap.id}
                      onClick={async () => {
                        setChatError(null)
                        const msg = `${t('chat.aboutClient')} ${activeClientName}: ${gap.question}`
                        if (conversationId) {
                          try {
                            await supabase.from('conversation_messages').insert({
                              conversation_id: conversationId,
                              role: 'user',
                              content: msg,
                            })
                          } catch (err) {
                            console.error('[Ask J] Failed to save gap question:', err)
                          }
                        }
                        handleInputChange({ target: { value: msg } } as React.ChangeEvent<HTMLInputElement>)
                        setTimeout(() => {
                          const form = document.querySelector('form[data-chat-form]') as HTMLFormElement
                          if (form) form.requestSubmit()
                        }, 150)
                      }}
                      className="px-3 py-1.5 bg-amber/[0.06] border border-amber/20 rounded-full text-amber text-[11px] cursor-pointer transition-colors hover:border-amber/50"
                    >
                      {gap.question.length > 50 ? gap.question.substring(0, 50) + '...' : gap.question}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          messages.map((m) => (
            <ChatMessage
              key={m.id}
              role={m.role as 'user' | 'assistant'}
              content={m.content}
              messageId={m.id}
              clientId={activeClientId || null}
            />
          ))
        )}

        {/* Error display */}
        {chatError && (
          <div className="flex justify-start mb-3">
            <div className="max-w-[80%] px-4 py-3 rounded-[16px_16px_16px_4px] bg-destructive/[0.08] border border-destructive/20 text-destructive text-[13px]">
              <strong>{t('chat.error')}:</strong> {chatError}
              <button
                onClick={() => setChatError(null)}
                className="ml-2 bg-transparent border-none text-destructive cursor-pointer text-xs underline"
              >
                {t('chat.dismiss')}
              </button>
            </div>
          </div>
        )}

        {isLoading && messages[messages.length - 1]?.role === 'user' && (
          <div className="flex justify-start mb-3">
            <div className="px-4 py-3 rounded-[16px_16px_16px_4px] bg-card border border-border text-muted-foreground text-[13px] flex items-center gap-2">
              <span className="w-5 h-5 rounded inline-flex items-center justify-center bg-primary/10 text-[10px] font-bold text-primary font-mono">
                J
              </span>
              <span className="inline-block animate-pulse">
                {t('chat.thinking')}
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
        className="px-5 py-4 border-t border-border bg-card flex gap-2.5"
      >
        <input
          value={input}
          onChange={handleInputChange}
          placeholder={
            activeClientName
              ? `${t('chat.askAboutClient')} ${activeClientName}...`
              : t('chat.askGeneric')
          }
          disabled={isLoading || loadingHistory}
          className="flex-1 px-4 py-3 bg-background border border-border rounded-[10px] text-foreground text-sm outline-none focus:border-primary transition-colors"
        />
        <button
          type="submit"
          disabled={isSubmitDisabled}
          className={cn(
            'px-6 py-3 border-none rounded-[10px] font-bold text-[13px] font-mono transition-all',
            isSubmitDisabled
              ? 'bg-secondary text-muted-foreground cursor-not-allowed'
              : 'bg-primary text-background cursor-pointer hover:bg-primary/90'
          )}
        >
          {isLoading ? '...' : t('chat.send')}
        </button>
      </form>
    </div>
  )
}
