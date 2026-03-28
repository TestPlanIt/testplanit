import type { EntityType } from "~/lib/llm/services/auto-tag/types";

/** Shape of a single entity's suggestions as stored in job result */
export interface AutoTagSuggestionEntity {
  entityId: number;
  entityType: EntityType;
  entityName: string;
  currentTags: string[];
  tags: Array<{
    tagName: string;
    isExisting: boolean;
    matchedExistingTag?: string;
  }>;
  /** True if this entity was in a failed batch and could not be analyzed */
  failed?: boolean;
  /** True if this entity's suggestions were lost due to truncated LLM response */
  truncated?: boolean;
  /** Human-readable error reason when failed or truncated */
  errorMessage?: string;
  /** For repositoryCase: whether the case is automated */
  automated?: boolean;
  /** For repositoryCase: the source type (MANUAL, JUNIT, etc.) */
  source?: string;
  /** For testRun: the run type (REGULAR, JUNIT, etc.) */
  testRunType?: string;
}

/** Per-entity selection state: set of accepted tag names */
export type AutoTagSelection = Map<number, Set<string>>;

/** Job status from polling endpoint */
export type AutoTagJobState =
  | "idle"
  | "waiting"
  | "active"
  | "completed"
  | "failed";

/** Return type of useAutoTagJob hook */
export interface UseAutoTagJobReturn {
  // Job lifecycle
  jobId: string | null;
  status: AutoTagJobState;
  progress: { analyzed: number; total: number; finalizing?: boolean } | null;
  error: string | null;

  // Results and selections
  suggestions: AutoTagSuggestionEntity[] | null;
  selections: AutoTagSelection;

  // Tag edits: original name -> edited name
  edits: Map<string, string>;

  // Actions
  submit: (
    entityIds: number[],
    entityType: EntityType,
    projectId: number,
    options?: { allowNewTags?: boolean }
  ) => Promise<void>;
  toggleTag: (entityId: number, tagName: string) => void;
  editTag: (entityId: number, oldName: string, newName: string) => void;
  apply: () => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;

  // Computed
  summary: { assignCount: number; newCount: number };
  isApplying: boolean;
  isSubmitting: boolean;
}
