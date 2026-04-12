import type { ParsedDocument, ParsedSegment } from '../types'

interface Turn {
  speaker: string
  text: string
  startSec: number | null
  endSec: number | null
  timestamp: string
}

export async function parseTranscriptTeams(buffer: Buffer): Promise<ParsedDocument> {
  const text = buffer.toString('utf8')
  const turns = parseTurns(text)

  const segments: ParsedSegment[] = turns.map((t, i) => ({
    label: `Speaker: ${t.speaker || 'Unknown'}`,
    content: t.text,
    metadata: {
      index: i,
      speaker: t.speaker || null,
      startSec: t.startSec,
      endSec: t.endSec,
      timestamp: t.timestamp || null,
    },
  }))

  const rawText = turns
    .map((t) => `**${t.speaker || 'Unknown'}** ${t.timestamp ? `[${t.timestamp}]` : ''}: ${t.text}`.trim())
    .join('\n\n')
    .trim()

  const participants = Array.from(
    new Set(turns.map((t) => t.speaker).filter((s): s is string => Boolean(s)))
  )

  let approximateDurationSec: number | null = null
  const lastWithEnd = [...turns].reverse().find((t) => t.endSec !== null)
  const firstWithStart = turns.find((t) => t.startSec !== null)
  if (lastWithEnd && firstWithStart && lastWithEnd.endSec !== null && firstWithStart.startSec !== null) {
    approximateDurationSec = Math.max(0, lastWithEnd.endSec - firstWithStart.startSec)
  }

  return {
    rawText: rawText.length > 0 ? rawText : text.trim(),
    segments,
    metadata: {
      participants,
      segmentCount: turns.length,
      approximateDurationSec,
    },
  }
}

function parseTurns(text: string): Turn[] {
  const cleaned = text.replace(/\r\n/g, '\n').replace(/^WEBVTT[^\n]*\n+/i, '')
  const turns: Turn[] = []

  // Format A: WEBVTT-style cues
  // 0:00:01.234 --> 0:00:05.678
  // <v Speaker Name>some text</v>
  const cueRegex =
    /(\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?)\s*-->\s*(\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?)\s*\n([\s\S]*?)(?=\n\s*\n|\n\d{1,2}:\d{2}:\d{2}|$)/g
  let cueMatch: RegExpExecArray | null
  while ((cueMatch = cueRegex.exec(cleaned)) !== null) {
    const start = parseTimeStamp(cueMatch[1])
    const end = parseTimeStamp(cueMatch[2])
    const body = cueMatch[3].trim()
    const vMatch = body.match(/<v\s+([^>]+)>([\s\S]*?)(?:<\/v>|$)/)
    let speaker = ''
    let textBody = body
    if (vMatch) {
      speaker = vMatch[1].trim()
      textBody = vMatch[2].trim()
    } else {
      // Try a "Speaker: text" inside the cue body
      const colonMatch = body.match(/^([^:\n]{1,80}?):\s*([\s\S]+)$/)
      if (colonMatch) {
        speaker = colonMatch[1].trim()
        textBody = colonMatch[2].trim()
      }
    }
    textBody = stripVttTags(textBody)
    if (textBody.length > 0) {
      turns.push({
        speaker,
        text: textBody,
        startSec: start,
        endSec: end,
        timestamp: cueMatch[1],
      })
    }
  }

  if (turns.length > 0) return turns

  // Format B: lines like "[00:01:23] Name: text" or "00:01:23 Name: text"
  const lineRegex =
    /^\s*\[?(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?)\]?\s+([^:\n]{1,80}?):\s*(.+)$/gm
  let lineMatch: RegExpExecArray | null
  while ((lineMatch = lineRegex.exec(cleaned)) !== null) {
    const ts = lineMatch[1]
    const speaker = lineMatch[2].trim()
    const body = lineMatch[3].trim()
    if (body.length === 0) continue
    turns.push({
      speaker,
      text: body,
      startSec: parseTimeStamp(ts),
      endSec: null,
      timestamp: ts,
    })
  }

  if (turns.length > 0) return turns

  // Format C: "Name: text" with no timestamps
  const noTsRegex = /^\s*([A-Z][^:\n]{0,79}?):\s*(.+)$/gm
  let nMatch: RegExpExecArray | null
  while ((nMatch = noTsRegex.exec(cleaned)) !== null) {
    const speaker = nMatch[1].trim()
    const body = nMatch[2].trim()
    if (body.length === 0) continue
    turns.push({
      speaker,
      text: body,
      startSec: null,
      endSec: null,
      timestamp: '',
    })
  }

  return turns
}

function parseTimeStamp(ts: string): number | null {
  if (!ts) return null
  const normalized = ts.replace(',', '.')
  const parts = normalized.split(':').map(parseFloat)
  if (parts.some((p) => Number.isNaN(p))) return null
  let seconds = 0
  if (parts.length === 3) {
    seconds = parts[0] * 3600 + parts[1] * 60 + parts[2]
  } else if (parts.length === 2) {
    seconds = parts[0] * 60 + parts[1]
  } else if (parts.length === 1) {
    seconds = parts[0]
  }
  return seconds
}

function stripVttTags(s: string): string {
  return s
    .replace(/<\/?v[^>]*>/gi, '')
    .replace(/<\/?[^>]+>/g, '')
    .trim()
}
