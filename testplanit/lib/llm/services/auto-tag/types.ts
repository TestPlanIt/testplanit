export type EntityType = "repositoryCase" | "testRun" | "session";

/** Represents one entity's content extracted for LLM consumption */
export interface EntityContent {
  id: number;
  entityType: EntityType;
  name: string;
  textContent: string;
  existingTagNames: string[];
  estimatedTokens: number;
}

/** A single tag suggestion from the AI */
export interface TagSuggestion {
  entityId: number;
  entityType: EntityType;
  tagName: string;
  isExisting: boolean;
  matchedExistingTag?: string;
  confidence?: number;
}

/** Result for one batch of entities */
export interface BatchAnalysisResult {
  suggestions: TagSuggestion[];
  tokensUsed: number;
}

/** Full result across all batches */
export interface TagAnalysisResult {
  suggestions: TagSuggestion[];
  totalTokensUsed: number;
  batchCount: number;
  entityCount: number;
  failedBatchCount: number;
  errors: string[];
  /** Entity IDs that were in failed batches (no suggestions produced) */
  failedEntityIds: number[];
  /** Entity IDs whose suggestions were lost due to truncated LLM responses */
  truncatedEntityIds: number[];
  /** True if processing was cancelled before all batches completed */
  cancelled: boolean;
}

/** Raw AI response shape (what we expect back from the LLM) */
export interface AutoTagAIResponse {
  suggestions: Array<{
    entityId: number;
    tags: string[];
  }>;
}
