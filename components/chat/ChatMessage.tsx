'use client'

import { useState } from 'react'
import MarkdownRenderer from '@/components/shared/MarkdownRenderer'
import SaveToMemoryDialog from './SaveToMemoryDialog'
import { useLocale } from '@/lib/i18n'
import { B } from '@/lib/brand'

interface ChatMessageProps {
  role: 'user' | 'assistant'
  content: string
  messageId?: string
  clientId?: string | null
}

export default function ChatMessage({ role, content, messageId, clientId }: ChatMessageProps) {
  const { t } = useLocale()
  const [dialogOpen, setDialogOpen] = useState(false)
  const isUser = role === 'user'
  const canPin = !isUser && !!clientId && !!messageId && content.trim().length > 0

  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: '12px',
    }}>
      <div style={{ maxWidth: '80%', display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
        <div style={{
          padding: '12px 16px',
          borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
          background: isUser ? B.primary : B.surface,
          color: isUser ? B.bg : B.ink,
          fontSize: '14px',
          lineHeight: '1.6',
          border: isUser ? 'none' : `1px solid ${B.border}`,
          wordBreak: 'break-word',
        }}>
          {isUser ? (
            <div style={{ whiteSpace: 'pre-wrap' }}>{content}</div>
          ) : (
            <MarkdownRenderer
              content={content}
              accentColor={B.primary}
              textColor={B.ink}
            />
          )}
        </div>

        {canPin && (
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            title={t('chat.saveToMemory')}
            className="mt-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors cursor-pointer"
          >
            {'\u{1F4CC}'} {t('chat.saveToMemory')}
          </button>
        )}
      </div>

      {dialogOpen && canPin && (
        <SaveToMemoryDialog
          clientId={clientId!}
          messageId={messageId!}
          initialText={content}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </div>
  )
}
