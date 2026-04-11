'use client'

import MarkdownRenderer from '@/components/shared/MarkdownRenderer'

interface ChatMessageProps {
  role: 'user' | 'assistant'
  content: string
}

export default function ChatMessage({ role, content }: ChatMessageProps) {
  const isUser = role === 'user'

  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: '12px',
    }}>
      <div style={{
        maxWidth: '80%',
        padding: '12px 16px',
        borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
        background: isUser ? '#c8e64a' : '#1a1c24',
        color: isUser ? '#111318' : '#e0e0e0',
        fontSize: '14px',
        lineHeight: '1.6',
        border: isUser ? 'none' : '1px solid #2a2d35',
        wordBreak: 'break-word',
      }}>
        {isUser ? (
          <div style={{ whiteSpace: 'pre-wrap' }}>{content}</div>
        ) : (
          <MarkdownRenderer
            content={content}
            accentColor="#c8e64a"
            textColor="#e0e0e0"
          />
        )}
      </div>
    </div>
  )
}
