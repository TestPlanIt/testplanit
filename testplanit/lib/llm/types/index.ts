/**
 * Core types for LLM integration
 */

// Import all types from Prisma - it generates them for us!
import type { LlmIntegration as Integration, LlmProvider, LlmProviderConfig } from "~/zenstack/models";

// Re-export the Prisma types
export type { Integration, LlmProviderConfig, LlmProvider };

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  messages: LlmMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  userId: string;
  projectId?: number;
  feature: string;
  metadata?: Record<string, any>;
  timeout?: number; // Optional timeout override in milliseconds
  disableThinking?: boolean; // Disable model reasoning/thinking for structured output
  /**
   * Per-call thinking budget (Gemini 2.5+/3.x family) in output-token units.
   * Takes precedence over `disableThinking`. Use when the model REQUIRES
   * thinking to be on (Gemini 2.5 Pro rejects `thinkingBudget: 0` with
   * "This model only works in thinking mode") but you want to cap how
   * many tokens the model spends reasoning so most of the output budget
   * remains for the actual content. Set to a small positive number
   * (e.g. 256–1024) for JSON-output features. Ignored by adapters that
   * don't expose a thinking control.
   */
  thinkingBudget?: number;
}

export interface LlmResponse {
  content: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cached?: boolean;
  finishReason?: "stop" | "length" | "content_filter" | "error";
}

export interface LlmStreamResponse {
  delta: string;
  model: string;
  finishReason?: "stop" | "length" | "content_filter" | "error";
}

export interface LlmError extends Error {
  code: string;
  statusCode?: number;
  provider: LlmProvider;
  retryable: boolean;
  details?: any;
}

export interface LlmAdapterConfig {
  integration: Integration;
  config: LlmProviderConfig;
  apiKey?: string;
  baseUrl?: string;
  organizationId?: string;
  additionalHeaders?: Record<string, string>;
}

/**
 * Per-model parameter capabilities discovered via probing during integration
 * setup. Persisted in `LlmProviderConfig.settings.modelCapabilities[modelId]`
 * so adapters can skip parameters the model rejects without paying the cost
 * of a failed-and-retried request on every call.
 */
export interface ModelCapabilities {
  /**
   * List of optional request parameters the model has been observed to reject
   * (e.g. ["temperature"] for newer Anthropic adaptive-thinking models).
   */
  unsupportedParams: string[];
  /**
   * ISO-8601 timestamp of the last successful probe. Used to surface staleness
   * in the admin UI and as a cache-busting hint.
   */
  probedAt: string;
}

/**
 * Shape of `LlmProviderConfig.settings` JSON when it carries probed model
 * capabilities. Other keys are preserved so the settings field remains a
 * general-purpose bag.
 */
export interface SettingsWithCapabilities {
  modelCapabilities?: Record<string, ModelCapabilities>;
  [key: string]: unknown;
}

export interface LlmModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
  inputCostPer1k?: number;
  outputCostPer1k?: number;
  capabilities?: string[];
  deprecated?: boolean;
}

export interface LlmUsageStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  latency: number;
}

export interface LlmFeature {
  id: string;
  name: string;
  description: string;
  defaultTemplate?: string;
  requiredVariables?: string[];
  outputFormat?: "text" | "json" | "markdown";
}

// Feature-specific types
export interface TestCaseGenerationRequest {
  requirement: string;
  context?: string;
  testType?: "unit" | "integration" | "e2e" | "acceptance";
  count?: number;
  includeEdgeCases?: boolean;
}

export interface BugAnalysisRequest {
  bugDescription: string;
  stackTrace?: string;
  environment?: string;
  reproductionSteps?: string[];
  attachments?: string[];
}

export interface ExploratoryTestSuggestionRequest {
  feature: string;
  userStories?: string[];
  existingTests?: string[];
  riskAreas?: string[];
}

export interface DocumentationImprovementRequest {
  content: string;
  type: "test-case" | "bug-report" | "feature" | "api";
  targetAudience?: "developer" | "tester" | "business";
  style?: "technical" | "user-friendly" | "concise";
}

// Ollama-specific types
export interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details: {
    format: string;
    family: string;
    families: string[];
    parameter_size: string;
    quantization_level: string;
  };
}

export interface OllamaPullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
  percent?: number;
}

// Rate limiting types
export interface RateLimitInfo {
  remaining: number;
  limit: number;
  reset: Date;
  retryAfter?: number;
}

// Template variable types
export interface TemplateVariable {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  required: boolean;
  description?: string;
  default?: any;
  validation?: {
    pattern?: string;
    min?: number;
    max?: number;
    enum?: any[];
  };
}
