import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  describeArgs,
  makeLinkCode,
  normalizeLinkCode,
  parseCommand,
  safeEqual,
  splitMessage,
} from './text'
import {
  MAX_STEPS,
  resumeAfterConfirm,
  runAgent,
  trimHistory,
  type AgentDeps,
  type AgentTool,
  type LlmTurn,
  type Message,
} from './agent'

const TOOLS: AgentTool[] = [
  { name: 'list_audits', description: '', inputSchema: {}, readOnly: true },
  { name: 'start_audit', description: '', inputSchema: {}, readOnly: false },
  { name: 'rerun_drivers', description: '', inputSchema: {}, readOnly: false },
]

function scripted(turns: LlmTurn[], ran: string[] = []): AgentDeps {
  let i = 0
  return {
    llm: async () => turns[Math.min(i++, turns.length - 1)],
    runTool: async (name) => {
      ran.push(name)
      return { text: `{"ok":"${name}"}`, isError: false }
    },
  }
}

test('splitMessage: short text stays whole, long text splits under the limit', () => {
  assert.deepEqual(splitMessage('ciao'), ['ciao'])
  assert.deepEqual(splitMessage('   '), [])
  const long = Array.from({ length: 400 }, (_, i) => `riga ${i} con un po di testo`).join('\n')
  const parts = splitMessage(long, 500)
  assert.ok(parts.length > 1)
  for (const p of parts) assert.ok(p.length <= 500)
  assert.equal(parts.join('\n').replace(/\s+/g, ' '), long.replace(/\s+/g, ' '))
})

test('link code: alphabet without look-alikes, normalised as typed', () => {
  const code = makeLinkCode(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]))
  assert.equal(code.length, 8)
  assert.ok(!/[01OIL]/.test(code))
  assert.equal(normalizeLinkCode(` ${code.slice(0, 4).toLowerCase()}-${code.slice(4)} `), code)
  assert.equal(normalizeLinkCode('ABC'), null)
  assert.equal(normalizeLinkCode('AAAAAAA0'), null)
})

test('parseCommand: commands, bot suffix, italian aliases, plain text', () => {
  assert.deepEqual(parseCommand('/start'), { kind: 'start' })
  assert.deepEqual(parseCommand('/collega@Jboostanalyser_bot abcd-efgh'), { kind: 'link', code: 'ABCDEFGH' })
  assert.deepEqual(parseCommand('/collega nope'), { kind: 'link', code: null })
  assert.deepEqual(parseCommand('/scollega'), { kind: 'unlink' })
  assert.deepEqual(parseCommand('/nuovo'), { kind: 'reset' })
  assert.deepEqual(parseCommand('/annulla'), { kind: 'cancel' })
  assert.deepEqual(parseCommand('/boh'), { kind: 'help' })
  assert.deepEqual(parseCommand('  elenca gli audit '), { kind: 'text', text: 'elenca gli audit' })
})

test('safeEqual and describeArgs', () => {
  assert.equal(safeEqual('abc', 'abc'), true)
  assert.equal(safeEqual('abc', 'abd'), false)
  assert.equal(safeEqual('abc', 'abcd'), false)
  assert.equal(describeArgs({ audit_id: 'JBA-0020', skip: null, drivers: ['seo', 'schema'] }), '• audit_id: JBA-0020\n• drivers: ["seo","schema"]')
  assert.equal(describeArgs(null), '')
})

test('agent: a read tool runs at once and the model answers', async () => {
  const ran: string[] = []
  const deps = scripted(
    [
      { content: [{ type: 'tool_use', id: 't1', name: 'list_audits', input: {} }] },
      { content: [{ type: 'text', text: 'Hai 2 audit.' }] },
    ],
    ran,
  )
  const out = await runAgent([{ role: 'user', content: 'audit?' }], TOOLS, deps)
  assert.equal(out.type, 'reply')
  if (out.type === 'reply') assert.equal(out.text, 'Hai 2 audit.')
  assert.deepEqual(ran, ['list_audits'])
})

test('agent: a write tool never runs without confirmation; the read next to it does', async () => {
  const ran: string[] = []
  const deps = scripted(
    [
      {
        content: [
          { type: 'tool_use', id: 'r1', name: 'list_audits', input: {} },
          { type: 'tool_use', id: 'w1', name: 'start_audit', input: { audit_id: 'JBA-0020' } },
          { type: 'tool_use', id: 'w2', name: 'rerun_drivers', input: {} },
        ],
      },
    ],
    ran,
  )
  const out = await runAgent([{ role: 'user', content: 'avvia' }], TOOLS, deps)
  assert.equal(out.type, 'confirm')
  assert.deepEqual(ran, ['list_audits'])
  if (out.type === 'confirm') {
    assert.equal(out.tool, 'start_audit')
    assert.equal(out.toolUseId, 'w1')
    // one result for the read, one error for the second write: every tool_use is answered
    assert.deepEqual(out.partialResults.map((r) => r.tool_use_id).sort(), ['r1', 'w2'])
    assert.equal(out.partialResults.find((r) => r.tool_use_id === 'w2')?.is_error, true)
  }
})

test('agent: confirm → the tool runs once and the model closes the turn', async () => {
  const ran: string[] = []
  const first = scripted(
    [{ content: [{ type: 'tool_use', id: 'w1', name: 'start_audit', input: { audit_id: 'JBA-0020' } }] }],
    ran,
  )
  const out = await runAgent([{ role: 'user', content: 'avvia JBA-0020' }], TOOLS, first)
  assert.equal(out.type, 'confirm')
  assert.equal(ran.length, 0)
  if (out.type !== 'confirm') return

  const seen: Message[][] = []
  const second: AgentDeps = {
    llm: async ({ messages }) => {
      seen.push([...messages])
      return { content: [{ type: 'text', text: 'Audit avviato.' }] }
    },
    runTool: async (name) => {
      ran.push(name)
      return { text: '{"started":true}', isError: false }
    },
  }
  const done = await resumeAfterConfirm(out, TOOLS, second)
  assert.deepEqual(ran, ['start_audit'])
  assert.equal(done.type, 'reply')
  const last = seen[0][seen[0].length - 1]
  assert.equal(last.role, 'user')
  assert.ok(Array.isArray(last.content) && (last.content[0] as { type: string }).type === 'tool_result')
})

test('agent: a loop that never answers stops after MAX_STEPS', async () => {
  let calls = 0
  const deps: AgentDeps = {
    llm: async () => {
      calls++
      return { content: [{ type: 'tool_use', id: `t${calls}`, name: 'list_audits', input: {} }] }
    },
    runTool: async () => ({ text: '[]', isError: false }),
  }
  const out = await runAgent([{ role: 'user', content: 'x' }], TOOLS, deps)
  assert.equal(out.type, 'reply')
  assert.equal(calls, MAX_STEPS)
})

test('trimHistory: text only, starts with a user turn, capped', () => {
  const history: Message[] = [
    { role: 'assistant', content: 'a0' },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'r' }] },
    ...Array.from({ length: 20 }, (_, i): Message => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `m${i}` })),
  ]
  const out = trimHistory(history)
  assert.ok(out.length <= 12)
  assert.equal(out[0].role, 'user')
  assert.ok(out.every((m) => typeof m.content === 'string'))
})
