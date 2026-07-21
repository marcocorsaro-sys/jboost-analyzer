/**
 * V4 — editability rules (Block 6).
 *
 * "Tutto editabile" is a product principle, not a licence to overwrite
 * anything: an analyst may correct a JUDGEMENT (the score shown, the comment
 * that explains it) but never the MEASUREMENT it came from.
 *
 * That is why raw_value is not editable here. A raw is what a source
 * reported; editing it would silently re-normalize every other site in the
 * set — the client's edit would move the competitors' scores — and the audit
 * trail would show a number no source ever produced. If a raw is wrong, the
 * honest move is to re-run the driver or fix the source, not to type over it.
 *
 * Edits are applied to the driver_runs row immediately (the analyst must see
 * what they did) and recorded in `edits` as drafts. Save & Publish stamps
 * them: publication is what marks a state as the one deliverables may be
 * generated from, not what makes the number visible in the workspace.
 */

export const EDITABLE_FIELDS = [
  'score_relative',
  'score_absolute',
  'comment_relative',
  'comment_absolute',
] as const

export type EditableField = (typeof EDITABLE_FIELDS)[number]

export interface EditPatch {
  field: EditableField
  value: number | string | null
}

export interface EditValidation {
  patch: EditPatch | null
  error: string | null
}

/** Validate one field edit against the DB constraints, before touching the DB. */
export function validateEdit(field: string, value: unknown): EditValidation {
  if (!EDITABLE_FIELDS.includes(field as EditableField)) {
    return {
      patch: null,
      error:
        `campo "${field}" non modificabile. Modificabili: ${EDITABLE_FIELDS.join(', ')}. ` +
        'Il raw è la misura della fonte: per cambiarlo si rilancia il driver.',
    }
  }

  if (field === 'comment_relative' || field === 'comment_absolute') {
    if (value === null || value === undefined || value === '') {
      return { patch: { field: field as EditableField, value: null }, error: null }
    }
    if (typeof value !== 'string') {
      return { patch: null, error: `${field} deve essere testo` }
    }
    return { patch: { field: field as EditableField, value }, error: null }
  }

  // Scores: null means "torna a non valorizzato", which is legitimate — an
  // analyst may decide a driver should show nothing rather than a number.
  if (value === null || value === undefined || value === '') {
    return { patch: { field: field as EditableField, value: null }, error: null }
  }

  const n = Number(value)
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    return { patch: null, error: `${field} deve essere un numero fra 0 e 100 (ricevuto: ${String(value)})` }
  }

  // score_absolute is INTEGER in the schema, score_relative NUMERIC(4,1).
  const rounded = field === 'score_absolute' ? Math.round(n) : Math.round(n * 10) / 10
  return { patch: { field: field as EditableField, value: rounded }, error: null }
}

/** Validate a batch, keeping every error rather than stopping at the first. */
export function validateEdits(input: Record<string, unknown>): {
  patches: EditPatch[]
  errors: string[]
} {
  const patches: EditPatch[] = []
  const errors: string[] = []

  for (const [field, value] of Object.entries(input)) {
    const { patch, error } = validateEdit(field, value)
    if (error) errors.push(error)
    else if (patch) patches.push(patch)
  }

  if (patches.length === 0 && errors.length === 0) {
    errors.push('nessun campo da modificare')
  }

  return { patches, errors }
}
