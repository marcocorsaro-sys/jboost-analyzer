/**
 * Schema Radiography — scoring.
 *
 * Pure, deterministic scoring based on the rubrics in lib/schema/rubrics.ts.
 * Both the current score and the "projected score after enrichment" use the
 * same formula — projected is just current + the proposed properties marked
 * as present.
 */

import {
  RUBRICS,
  TIER_WEIGHT,
  resolveType,
  type SchemaRubric,
  type RubricProperty,
} from './rubrics'
import { isPropertyPresent, type SchemaBlock } from './extract'

export interface BlockScore {
  /** Rubric type used to score (after alias resolution). Null if no rubric. */
  rubricType: string | null
  /** 0-100 — what the block actually scores today. */
  score: number
  /** Properties present + counted. */
  present: string[]
  /** Required-tier properties missing. */
  missingRequired: RubricProperty[]
  /** Google-recommended properties missing. */
  missingRecommendedGoogle: RubricProperty[]
  /** Schema.org recommended properties missing. */
  missingRecommendedSchema: RubricProperty[]
  /** Sum of weights of properties counted. */
  achievedWeight: number
  /** Sum of weights of all rubric properties (denominator). */
  totalWeight: number
}

const EMPTY_SCORE: BlockScore = {
  rubricType: null,
  score: 0,
  present: [],
  missingRequired: [],
  missingRecommendedGoogle: [],
  missingRecommendedSchema: [],
  achievedWeight: 0,
  totalWeight: 0,
}

/** Score a single JSON-LD block against its type rubric. */
export function scoreBlock(block: SchemaBlock): BlockScore {
  const rubricType = resolveType(block.type)
  if (!rubricType) return EMPTY_SCORE
  const rubric = RUBRICS[rubricType]
  return scoreAgainstRubric(block.raw, rubric)
}

/**
 * Compute the projected score the block would land at if every property in
 * `proposedKeys` were added with a non-empty value (deterministic — uses the
 * same scoring formula as `scoreBlock`).
 */
export function projectScore(
  block: SchemaBlock,
  proposedKeys: string[],
): BlockScore {
  const rubricType = resolveType(block.type)
  if (!rubricType) return EMPTY_SCORE
  const rubric = RUBRICS[rubricType]
  // Build a synthetic block where each proposed property is marked as filled.
  const synthetic: Record<string, unknown> = { ...block.raw }
  for (const k of proposedKeys) {
    if (!isPropertyPresent(synthetic, k)) {
      synthetic[k] = '__projected__'
    }
  }
  return scoreAgainstRubric(synthetic, rubric)
}

/** Project a NEW block (zero current properties) where every proposed key is filled. */
export function projectNewBlock(
  rubricType: string,
  proposedKeys: string[],
): BlockScore {
  const rubric = RUBRICS[rubricType]
  if (!rubric) return EMPTY_SCORE
  const synthetic: Record<string, unknown> = {}
  for (const k of proposedKeys) synthetic[k] = '__projected__'
  return scoreAgainstRubric(synthetic, rubric)
}

function scoreAgainstRubric(
  raw: Record<string, unknown>,
  rubric: SchemaRubric,
): BlockScore {
  let achievedWeight = 0
  let totalWeight = 0
  const present: string[] = []
  const missingRequired: RubricProperty[] = []
  const missingRecommendedGoogle: RubricProperty[] = []
  const missingRecommendedSchema: RubricProperty[] = []

  for (const prop of rubric.properties) {
    const w = TIER_WEIGHT[prop.tier]
    totalWeight += w
    if (isPropertyPresent(raw, prop.key)) {
      achievedWeight += w
      present.push(prop.key)
    } else {
      if (prop.tier === 'required') missingRequired.push(prop)
      else if (prop.tier === 'recommended_google') missingRecommendedGoogle.push(prop)
      else missingRecommendedSchema.push(prop)
    }
  }

  const score = totalWeight > 0 ? Math.round((achievedWeight / totalWeight) * 100) : 0
  return {
    rubricType: rubric.type,
    score,
    present,
    missingRequired,
    missingRecommendedGoogle,
    missingRecommendedSchema,
    achievedWeight,
    totalWeight,
  }
}

/**
 * Average a list of per-occurrence scores into a single template-level number,
 * weighted equally per page (every page where the template appears counts the
 * same).
 */
export function averageScores(scores: BlockScore[]): number {
  if (scores.length === 0) return 0
  const sum = scores.reduce((acc, s) => acc + s.score, 0)
  return Math.round(sum / scores.length)
}

/**
 * Overall site score — straight average of all template scores (each template
 * counts once, regardless of how many pages it appears on, so a 100/100
 * BreadcrumbList on 30 pages doesn't drown out a 30/100 Product).
 */
export function overallScore(templateScores: number[]): number {
  if (templateScores.length === 0) return 0
  const sum = templateScores.reduce((acc, s) => acc + s, 0)
  return Math.round(sum / templateScores.length)
}
