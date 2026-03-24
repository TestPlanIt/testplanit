/**
 * DuplicateScanService — core duplicate test case detection engine.
 *
 * Orchestrates multi-signal similarity detection using Elasticsearch more_like_this
 * queries combined with Jaro-Winkler name similarity, Jaccard tag overlap, and
 * field value matching. Results are expressed as HIGH/MEDIUM/LOW confidence buckets.
 *
 * All queries are scoped to a single project — cross-project detection is out of scope.
 */

import type { PrismaClient } from "@prisma/client";
import type { Client } from "@elastic/elasticsearch";
import { getRepositoryCaseIndexName } from "~/services/elasticsearchService";
import {
  jaroWinkler,
  levenshteinRatio,
  jaccardSimilarity,
  combineScores,
  scoreToConfidence,
  type ConfidenceBucket,
} from "~/lib/utils/similarity";

/**
 * ES _score is unbounded. Normalize to 0-1 by capping at this value then dividing.
 * Scores above MAX_ES_SCORE clamp to 1.0.
 */
const MAX_ES_SCORE = 10.0;

/**
 * Threshold for including "steps" in matchedFields.
 * Corresponds to a normalizedEsScore of 0.3 (i.e. rawEsScore >= 3.0).
 */
const STEPS_SCORE_THRESHOLD = 0.3;

export interface CaseSearchInput {
  /** Source case ID — excluded from results to avoid self-matches. */
  id?: number;
  name: string;
  steps?: Array<{ step: string; expectedResult: string }>;
  tags?: Array<{ name: string }>;
  customFieldValues?: Array<{ fieldName: string; value: string }>;
}

export interface SimilarCasePair {
  caseAId: number;
  caseBId: number;
  /** 0.0-1.0 combined weighted score */
  score: number;
  confidence: ConfidenceBucket;
  /** Which fields contributed to the match, e.g. ["name", "steps", "tags"] */
  matchedFields: string[];
}

type EsHit = {
  _score: number | null;
  _source: {
    id: number;
    name: string;
    projectId: number;
    tags?: Array<{ name: string }>;
    customFields?: Array<{ fieldName: string; value?: any }>;
    steps?: Array<{ step: string; expectedResult: string }>;
  };
};

export class DuplicateScanService {
  constructor(
    private prisma: PrismaClient,
    private esClient: Client | null,
  ) {}

  /**
   * Find test cases similar to the given case within a project.
   *
   * Uses Elasticsearch more_like_this for name/step text similarity, then
   * enriches each candidate with Jaro-Winkler (name), Jaccard (tags), and
   * field-value overlap scores before combining into a single weighted score.
   *
   * @param caseData - Input case data including name, optional steps/tags/fields
   * @param projectId - Project scope — results are strictly limited to this project
   * @param tenantId - Optional tenant ID for multi-tenant index naming
   * @returns Scored, canonically-ordered pairs with confidence bucket
   */
  async findSimilarCases(
    caseData: CaseSearchInput,
    projectId: number,
    tenantId?: string,
  ): Promise<SimilarCasePair[]> {
    if (!this.esClient) return [];

    const indexName = getRepositoryCaseIndexName(tenantId);

    const response = await this.esClient.search({
      index: indexName,
      query: {
        bool: {
          must: [
            {
              more_like_this: {
                fields: ["name", "steps.step", "steps.expectedResult"],
                like: [
                  {
                    doc: {
                      name: caseData.name,
                      steps:
                        caseData.steps?.map((s) => ({
                          step: s.step,
                          expectedResult: s.expectedResult,
                        })) ?? [],
                    },
                  },
                ],
                min_term_freq: 1,
                min_doc_freq: 1,
                max_query_terms: 25,
                minimum_should_match: "1",
              },
            },
          ],
          filter: [
            { term: { projectId: projectId } },
            { term: { isDeleted: false } },
          ],
        },
      },
      size: 50,
      min_score: 5.0,
    });

    const hits = (response.hits?.hits ?? []) as EsHit[];

    const pairs: SimilarCasePair[] = [];
    const sourceId = caseData.id;
    const sourceTags = (caseData.tags ?? []).map((t) => t.name);
    const sourceFieldValues = (caseData.customFieldValues ?? []).map(
      (f) => `${f.fieldName}:${f.value}`,
    );

    for (const hit of hits) {
      const candidate = hit._source;
      if (!candidate) continue;
      // Exclude the source case itself
      if (sourceId != null && candidate.id === sourceId) continue;

      // Normalize ES score to 0-1
      const rawEsScore = hit._score ?? 0;
      const normalizedEsScore = Math.min(rawEsScore / MAX_ES_SCORE, 1.0);

      // Per-signal scores
      // Dual name gate: requires BOTH high character similarity AND high word overlap.
      // This catches true duplicates (same test, minor wording) while filtering out
      // cases that follow the same naming convention but test different things.
      const nameLevenshtein = levenshteinRatio(caseData.name, candidate.name);
      if (nameLevenshtein < 0.85) continue;

      // Token-level check: split into words and compare overlap
      const sourceWords = caseData.name.toLowerCase().split(/\s+/).filter(Boolean);
      const candidateWords = candidate.name.toLowerCase().split(/\s+/).filter(Boolean);
      const nameTokenJaccard = jaccardSimilarity(sourceWords, candidateWords);
      if (nameTokenJaccard < 0.80) continue;

      // Use Jaro-Winkler as the name signal in the combined score (better gradient)
      const nameScore = jaroWinkler(caseData.name, candidate.name);

      // ES MLT handles step text similarity — use normalized ES score as the steps signal
      const stepsScore = normalizedEsScore;
      const candidateTags = (candidate.tags ?? []).map((t) => t.name);
      const tagsScore = jaccardSimilarity(sourceTags, candidateTags);
      const candidateFieldValues = (candidate.customFields ?? []).map(
        (f) => `${f.fieldName}:${f.value}`,
      );
      const fieldsScore = jaccardSimilarity(sourceFieldValues, candidateFieldValues);

      // Combine with weights: name=0.5, steps=0.3, tags=0.1, fields=0.1
      const combined = combineScores({
        name: nameScore,
        steps: stepsScore,
        tags: tagsScore,
        fields: fieldsScore,
      });

      // Null means below threshold — skip
      const confidence = scoreToConfidence(combined);
      if (!confidence) continue;

      // Track which fields contributed to the match
      const matchedFields: string[] = [];
      if (nameScore >= 0.7) matchedFields.push("name");
      if (stepsScore >= STEPS_SCORE_THRESHOLD) matchedFields.push("steps");
      if (tagsScore > 0) matchedFields.push("tags");
      if (fieldsScore > 0) matchedFields.push("fields");

      // Canonical ordering: caseAId < caseBId always
      let caseAId: number;
      let caseBId: number;
      if (sourceId != null) {
        if (sourceId < candidate.id) {
          caseAId = sourceId;
          caseBId = candidate.id;
        } else {
          caseAId = candidate.id;
          caseBId = sourceId;
        }
      } else {
        caseAId = Math.min(0, candidate.id);
        caseBId = Math.max(0, candidate.id);
      }

      pairs.push({
        caseAId,
        caseBId,
        score: combined,
        confidence,
        matchedFields,
      });
    }

    // Sort by score descending
    pairs.sort((a, b) => b.score - a.score);
    return pairs;
  }
}
