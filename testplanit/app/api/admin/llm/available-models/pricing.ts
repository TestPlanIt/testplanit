// Per-model pricing discovery for the available-models route.
//
// Only some providers expose per-model cost through an API:
//  - LiteLLM proxies serve GET {base}/model/info with USD-per-token floats
//  - OpenRouter embeds USD-per-token strings in its /models response
//  - Together AI embeds USD-per-1M-token numbers in its /models response
// Everything is normalized to USD per 1M tokens, which is the unit the
// LlmProviderConfig cost fields use ("Cost Per 1M Input Tokens").

import { isCloudMetadataHostname } from "~/lib/utils/ssrf";

export interface ModelPricing {
  input: number;
  output: number;
}

export type ModelPricingMap = Record<string, ModelPricing>;

// LlmProviderConfig cost columns are Decimal(10,8), so values of $100/1M or
// more cannot be persisted. Such models are skipped rather than clamped so we
// never auto-fill a silently wrong cost.
const MAX_STORABLE_COST_PER_MILLION = 99.99999999;

/**
 * Same guard the LLM adapters' safeFetch applies: http(s) only and no cloud
 * metadata endpoints. Returns the parsed URL so callers fetch `parsed.href`.
 */
export function assertAllowedUrl(url: string): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`URL must use http or https protocol: ${url}`);
  }
  if (isCloudMetadataHostname(parsed.hostname)) {
    throw new Error(`Requests to ${parsed.hostname} are not allowed`);
  }
  return parsed;
}

/**
 * CUSTOM_LLM integrations store the full chat URL (e.g. ".../v1/chat/completions")
 * as their endpoint. Strip that suffix to recover the API base URL.
 */
export function stripChatCompletionsSuffix(endpoint: string): string {
  return endpoint
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/, "");
}

function roundToDbScale(value: number): number {
  // Decimal(10,8) — 8 fractional digits.
  return Math.round(value * 1e8) / 1e8;
}

function normalizePerMillion(
  input: unknown,
  output: unknown
): ModelPricing | null {
  const inputNum = typeof input === "string" ? parseFloat(input) : input;
  const outputNum = typeof output === "string" ? parseFloat(output) : output;
  if (typeof inputNum !== "number" || typeof outputNum !== "number") {
    return null;
  }
  if (!Number.isFinite(inputNum) || !Number.isFinite(outputNum)) {
    return null;
  }
  if (inputNum < 0 || outputNum < 0) {
    return null;
  }
  if (
    inputNum > MAX_STORABLE_COST_PER_MILLION ||
    outputNum > MAX_STORABLE_COST_PER_MILLION
  ) {
    return null;
  }
  return { input: roundToDbScale(inputNum), output: roundToDbScale(outputNum) };
}

/**
 * Pull pricing out of an OpenAI-compatible /models listing when the provider
 * embeds it. Two shapes exist in the wild:
 *  - OpenRouter: `pricing.prompt` / `pricing.completion` — USD per token, as strings
 *  - Together AI: `pricing.input` / `pricing.output` — USD per 1M tokens, as numbers
 */
export function extractEmbeddedPricing(models: unknown): ModelPricingMap {
  const result: ModelPricingMap = {};
  if (!Array.isArray(models)) {
    return result;
  }
  for (const model of models) {
    if (typeof model !== "object" || model === null) continue;
    const { id, pricing } = model as {
      id?: unknown;
      pricing?: Record<string, unknown>;
    };
    if (typeof id !== "string" || typeof pricing !== "object" || !pricing) {
      continue;
    }
    let normalized: ModelPricing | null = null;
    if ("prompt" in pricing || "completion" in pricing) {
      // OpenRouter — USD per single token; scale to per 1M.
      normalized = normalizePerMillion(
        Number(pricing.prompt) * 1_000_000,
        Number(pricing.completion) * 1_000_000
      );
    } else if ("input" in pricing || "output" in pricing) {
      // Together AI — already USD per 1M tokens.
      normalized = normalizePerMillion(pricing.input, pricing.output);
    }
    if (normalized) {
      result[id] = normalized;
    }
  }
  return result;
}

/**
 * Parse a LiteLLM `GET /model/info` payload. Costs are USD per single token
 * and may be null/absent for models LiteLLM has no cost map entry for.
 */
export function parseLiteLlmPricing(payload: unknown): ModelPricingMap {
  const result: ModelPricingMap = {};
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data)) {
    return result;
  }
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null) continue;
    const { model_name: modelName, model_info: modelInfo } = entry as {
      model_name?: unknown;
      model_info?: {
        input_cost_per_token?: unknown;
        output_cost_per_token?: unknown;
      };
    };
    if (typeof modelName !== "string" || !modelInfo) continue;
    const input = modelInfo.input_cost_per_token;
    const output = modelInfo.output_cost_per_token;
    if (typeof input !== "number" || typeof output !== "number") continue;
    const normalized = normalizePerMillion(
      input * 1_000_000,
      output * 1_000_000
    );
    if (normalized) {
      result[modelName] = normalized;
    }
  }
  return result;
}

/**
 * Best-effort probe of a LiteLLM proxy's /model/info endpoint. LiteLLM mounts
 * it at both {base}/model/info and {base}/v1/model/info, so appending to
 * whatever base the admin configured works either way. Any failure (non-LiteLLM
 * server, auth error, timeout) returns an empty map — pricing is a bonus, never
 * a reason to fail the models fetch.
 */
export async function fetchLiteLlmPricing(
  endpoint: string,
  apiKey?: string
): Promise<ModelPricingMap> {
  try {
    const base = endpoint.trim().replace(/\/+$/, "");
    const url = assertAllowedUrl(`${base}/model/info`);
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    const response = await fetch(url.href, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      return {};
    }
    return parseLiteLlmPricing(await response.json());
  } catch {
    return {};
  }
}
