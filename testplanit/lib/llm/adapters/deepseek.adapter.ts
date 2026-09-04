import type { LlmAdapterConfig, LlmModelInfo, LlmRequest } from "../types";
import { OpenAIAdapter, type OpenAIChatRequest } from "./openai.adapter";

export const DEEPSEEK_DEFAULT_BASE_URL = "https://api.deepseek.com";

/**
 * DeepSeek's per-request reasoning control. Thinking is on by default at
 * `high` effort; `disabled` turns the chain-of-thought off for the request.
 */
interface DeepSeekThinking {
  type: "enabled" | "disabled";
  reasoning_effort?: "low" | "high" | "max";
}

/**
 * DeepSeek speaks the OpenAI chat.completions dialect with a slightly
 * different parameter surface: the output cap is `max_tokens` (it does not
 * take `max_completion_tokens`), reasoning is toggled per request through
 * `thinking`, and `presence_penalty` / `frequency_penalty` are no longer
 * supported. Everything else — message shape, SSE framing, error envelope —
 * is inherited from the OpenAI adapter.
 */
interface DeepSeekChatRequest extends Omit<
  OpenAIChatRequest,
  "max_completion_tokens" | "frequency_penalty" | "presence_penalty"
> {
  max_tokens?: number;
  thinking?: DeepSeekThinking;
}

/**
 * Known DeepSeek models. The official `/models` listing carries ids only, so
 * display names and windows live here; unknown ids fall back to conservative
 * defaults so a newly released model still works before this table catches
 * up. `deepseek-chat` / `deepseek-reasoner` are the pre-V4 aliases: DeepSeek
 * announced their discontinuation for 2026-07-24 but still serves them as V4
 * Flash (non-thinking / thinking), so they are flagged deprecated rather than
 * dropped.
 */
const DEEPSEEK_MODELS: Record<string, Partial<LlmModelInfo>> = {
  "deepseek-v4-flash": {
    name: "DeepSeek V4 Flash",
    contextWindow: 1_000_000,
    maxOutputTokens: 384_000,
    capabilities: ["text", "code", "reasoning"],
  },
  "deepseek-v4-pro": {
    name: "DeepSeek V4 Pro",
    contextWindow: 1_000_000,
    maxOutputTokens: 384_000,
    capabilities: ["text", "code", "reasoning"],
  },
  "deepseek-v4-flash-vision-exp": {
    name: "DeepSeek V4 Flash Vision (experimental)",
    contextWindow: 1_000_000,
    maxOutputTokens: 384_000,
    capabilities: ["text", "code", "reasoning", "vision"],
  },
  "deepseek-chat": {
    name: "DeepSeek Chat (legacy alias)",
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    capabilities: ["text", "code"],
    deprecated: true,
  },
  "deepseek-reasoner": {
    name: "DeepSeek Reasoner (legacy alias)",
    contextWindow: 128_000,
    maxOutputTokens: 65_536,
    capabilities: ["text", "code", "reasoning"],
    deprecated: true,
  },
};

const DEFAULT_MODEL_IDS = ["deepseek-v4-flash", "deepseek-v4-pro"];

export class DeepSeekAdapter extends OpenAIAdapter {
  private readonly deepSeekBaseUrl: string;

  constructor(config: LlmAdapterConfig) {
    const baseUrl = (config.baseUrl || DEEPSEEK_DEFAULT_BASE_URL).replace(
      /\/+$/,
      ""
    );
    super({ ...config, baseUrl });
    this.deepSeekBaseUrl = baseUrl;
  }

  getProviderName(): string {
    return "DeepSeek";
  }

  protected buildChatRequest(
    request: LlmRequest,
    stream: boolean
  ): DeepSeekChatRequest {
    const { max_completion_tokens, ...base } = super.buildChatRequest(
      request,
      stream
    );
    const body: DeepSeekChatRequest = {
      ...base,
      max_tokens: max_completion_tokens,
    };
    const thinking = this.resolveThinking(request);
    if (thinking) {
      body.thinking = thinking;
    }
    return body;
  }

  /**
   * Map the provider-neutral thinking controls onto DeepSeek's `thinking`
   * parameter. Nothing is sent when the caller expressed no preference, so
   * the provider default (thinking on) applies. A `thinkingBudget` asks to
   * cap reasoning rather than remove it — DeepSeek exposes effort levels, not
   * token budgets, so any positive budget maps to `low`; zero or negative
   * disables thinking outright, matching the Gemini adapter's reading of 0.
   */
  private resolveThinking(request: LlmRequest): DeepSeekThinking | undefined {
    if (typeof request.thinkingBudget === "number") {
      return request.thinkingBudget > 0
        ? { type: "enabled", reasoning_effort: "low" }
        : { type: "disabled" };
    }
    if (request.disableThinking) {
      return { type: "disabled" };
    }
    return undefined;
  }

  async getAvailableModels(): Promise<LlmModelInfo[]> {
    try {
      const response = await this.safeFetch(`${this.deepSeekBaseUrl}/models`, {
        headers: this.getOpenAIHeaders(),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw this.createError(
          "Failed to fetch models",
          "FETCH_MODELS_ERROR",
          response.status
        );
      }

      const data = (await response.json()) as {
        data?: Array<{ id?: unknown }>;
      };
      const ids = (Array.isArray(data?.data) ? data.data : [])
        .map((model) => model?.id)
        .filter((id): id is string => typeof id === "string");

      return ids.length > 0
        ? ids.map((id) => this.toDeepSeekModelInfo(id))
        : this.deepSeekDefaultModels();
    } catch (error) {
      console.error("Failed to fetch DeepSeek models:", error);
      return this.deepSeekDefaultModels();
    }
  }

  protected extractErrorMessage(error: any): string {
    if (error?.error?.message) {
      return error.error.message;
    }
    return "Unknown DeepSeek error";
  }

  private toDeepSeekModelInfo(modelId: string): LlmModelInfo {
    const known = DEEPSEEK_MODELS[modelId] ?? {};
    return {
      id: modelId,
      name: known.name ?? modelId,
      contextWindow: known.contextWindow ?? 128_000,
      maxOutputTokens: known.maxOutputTokens ?? 8_192,
      capabilities: known.capabilities ?? ["text", "code"],
      deprecated: known.deprecated,
    };
  }

  private deepSeekDefaultModels(): LlmModelInfo[] {
    return DEFAULT_MODEL_IDS.map((id) => this.toDeepSeekModelInfo(id));
  }
}
