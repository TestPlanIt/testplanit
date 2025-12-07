/**
 * Core types for LLM integration
 */

// Import all types from Prisma - it generates them for us!
import type { 
  LlmIntegration as Integration,
  LlmProviderConfig,
  LlmPromptTemplate,
  LlmProvider 
} from "@prisma/client";

// Re-export the Prisma types
export type { 
  Integration,
  LlmProviderConfig,
  LlmPromptTemplate,
  LlmProvider 
};

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
