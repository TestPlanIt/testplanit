import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "~/server/auth";
import {
  assertAllowedUrl,
  extractEmbeddedPricing,
  fetchLiteLlmPricing,
  stripChatCompletionsSuffix,
  type ModelPricingMap,
} from "./pricing";

interface ModelsResult {
  models: string[];
  pricing: ModelPricingMap;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.user.access !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { provider, apiKey, endpoint } = await request.json();

    if (!provider) {
      return NextResponse.json(
        { success: false, error: "Provider is required" },
        { status: 400 }
      );
    }

    let result: ModelsResult;

    switch (provider) {
      case "OPENAI":
        result = await fetchOpenAiModels(apiKey, endpoint);
        break;
      case "GEMINI":
        result = await fetchGeminiModels(apiKey, endpoint);
        break;
      case "ANTHROPIC":
        result = await fetchAnthropicModels(apiKey, endpoint);
        break;
      case "OLLAMA":
        result = await fetchOllamaModels(endpoint);
        break;
      case "CUSTOM_LLM":
        result = await fetchCustomLlmModels(apiKey, endpoint);
        break;
      default:
        return NextResponse.json(
          { success: false, error: `Unsupported provider: ${provider}` },
          { status: 400 }
        );
    }

    return NextResponse.json({
      success: true,
      models: result.models,
      // USD per 1M tokens, keyed by model id. Only populated when the
      // provider exposes pricing (LiteLLM /model/info, OpenRouter, Together).
      pricing: result.pricing,
    });
  } catch (error) {
    console.error("Error fetching available models:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

/**
 * Extract model ids from an OpenAI-compatible /models response. Most providers
 * wrap the list as `{data: [...]}`; Together AI returns a bare array.
 */
function extractModelList(payload: unknown): any[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  const data = (payload as { data?: unknown })?.data;
  return Array.isArray(data) ? data : [];
}

async function fetchOpenAiModels(
  apiKey?: string,
  endpoint?: string
): Promise<ModelsResult> {
  if (!apiKey) {
    throw new Error("API key is required for OpenAI");
  }

  const baseUrl = endpoint?.trim() || "https://api.openai.com/v1";
  const normalizedBase = baseUrl.replace(/\/$/, "");
  let isCustomEndpoint = false;
  try {
    isCustomEndpoint = new URL(normalizedBase).hostname !== "api.openai.com";
  } catch {
    isCustomEndpoint = true;
  }
  const url = `${normalizedBase}/models`;

  try {
    const response = await fetch(assertAllowedUrl(url).href, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
    }

    const list = extractModelList(await response.json());

    const models = list
      .map((model: any) => model?.id)
      .filter(
        (id: unknown): id is string =>
          typeof id === "string" &&
          // The official API lists many non-chat models (embeddings, tts,
          // dall-e, ...); keep the gpt filter there. Proxies (LiteLLM,
          // OpenRouter, Together) list exactly what they serve, which is
          // often not gpt-named — show everything.
          (isCustomEndpoint || id.includes("gpt"))
      )
      .sort();

    const pricing = extractEmbeddedPricing(list);
    if (isCustomEndpoint) {
      Object.assign(pricing, await fetchLiteLlmPricing(normalizedBase, apiKey));
    }

    return { models, pricing };
  } catch (error) {
    console.error("Error fetching OpenAI models:", error);
    throw new Error(
      `Failed to fetch OpenAI models: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

async function fetchGeminiModels(
  apiKey: string,
  endpoint?: string
): Promise<ModelsResult> {
  if (!apiKey) {
    throw new Error("API key is required for Gemini");
  }

  const baseUrl =
    endpoint || "https://generativelanguage.googleapis.com/v1beta";
  const url = `${baseUrl}/models?key=${apiKey}`;

  try {
    const response = await fetch(assertAllowedUrl(url).href, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Gemini API error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();

    // Extract model names from the response
    if (data.models && Array.isArray(data.models)) {
      const models = data.models
        .filter((model: any) => {
          // Filter for generation models only
          return (
            model.name &&
            model.supportedGenerationMethods?.includes("generateContent") &&
            !model.name.includes("embedding")
          ); // Exclude embedding models
        })
        .map((model: any) => {
          // Extract just the model name (e.g., "models/gemini-1.5-flash" -> "gemini-1.5-flash")
          return model.name.replace("models/", "");
        })
        .sort();
      // The Gemini models API exposes no pricing fields.
      return { models, pricing: {} };
    }

    return { models: [], pricing: {} };
  } catch (error) {
    console.error("Error fetching Gemini models:", error);
    throw new Error(
      `Failed to fetch Gemini models: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

async function fetchAnthropicModels(
  apiKey?: string,
  endpoint?: string
): Promise<ModelsResult> {
  if (!apiKey) {
    throw new Error("API key is required for Anthropic");
  }

  const trimmedEndpoint = endpoint?.trim();
  let isCustomEndpoint = false;
  if (trimmedEndpoint) {
    try {
      const url = new URL(trimmedEndpoint);
      isCustomEndpoint = url.hostname !== "api.anthropic.com";
    } catch {
      isCustomEndpoint = true;
    }
  }
  const baseUrl =
    endpoint?.trim()?.replace(/\/$/, "") || "https://api.anthropic.com/v1";

  try {
    let response: Response;

    if (isCustomEndpoint) {
      // LiteLLM and other proxies use OpenAI-compatible /models endpoint with Bearer auth
      response = await fetch(assertAllowedUrl(`${baseUrl}/models`).href, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(10000),
      });
    } else {
      // Direct Anthropic API uses x-api-key auth. Its models API exposes no
      // pricing fields.
      response = await fetch(
        assertAllowedUrl(`${baseUrl}/models?limit=1000`).href,
        {
          method: "GET",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          signal: AbortSignal.timeout(10000),
        }
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${errorText}`);
    }

    const list = extractModelList(await response.json());

    const models = list
      .map((model: any) => model?.id)
      .filter((id: unknown): id is string => typeof id === "string")
      .sort();

    const pricing = isCustomEndpoint ? extractEmbeddedPricing(list) : {};
    if (isCustomEndpoint) {
      Object.assign(pricing, await fetchLiteLlmPricing(baseUrl, apiKey));
    }

    return { models, pricing };
  } catch (error) {
    console.error("Error fetching Anthropic models:", error);
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(
        "Anthropic API is not responding. Please check your API key and try again."
      );
    }
    throw new Error(
      `Failed to fetch Anthropic models: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

async function fetchOllamaModels(endpoint?: string): Promise<ModelsResult> {
  if (!endpoint?.trim()) {
    throw new Error("Endpoint URL is required for Ollama");
  }
  const baseUrl = endpoint.trim();
  const url = `${baseUrl}/api/tags`;

  try {
    const response = await fetch(assertAllowedUrl(url).href, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      // Add timeout for local Ollama instance
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(
        `Ollama API error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();

    // Extract model names from the response. Ollama is local — no pricing.
    if (data.models && Array.isArray(data.models)) {
      const models = data.models
        .map((model: any) => model.name || model.model)
        .filter((name: string) => name) // Remove any undefined/null names
        .sort();
      return { models, pricing: {} };
    }

    return { models: [], pricing: {} };
  } catch (error) {
    console.error("Error fetching Ollama models:", error);
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(
        "Ollama server is not responding. Make sure Ollama is running and accessible."
      );
    }
    throw new Error(
      `Failed to fetch Ollama models: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Custom LLM endpoints store the full chat URL; many of them (LiteLLM,
 * OpenRouter, Together, vLLM, LM Studio) are OpenAI-compatible, so try the
 * sibling /models endpoint. The dialogs treat failures here as "manual model
 * entry" rather than an error, since a custom endpoint has no obligation to
 * be OpenAI-compatible.
 */
async function fetchCustomLlmModels(
  apiKey?: string,
  endpoint?: string
): Promise<ModelsResult> {
  if (!endpoint?.trim()) {
    throw new Error("Endpoint URL is required for a custom LLM");
  }
  const baseUrl = stripChatCompletionsSuffix(endpoint);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    const response = await fetch(assertAllowedUrl(`${baseUrl}/models`).href, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Custom LLM API error: ${response.status} ${errorText}`);
    }

    const list = extractModelList(await response.json());

    const models = list
      .map((model: any) => model?.id)
      .filter((id: unknown): id is string => typeof id === "string")
      .sort();

    const pricing = extractEmbeddedPricing(list);
    Object.assign(pricing, await fetchLiteLlmPricing(baseUrl, apiKey));

    return { models, pricing };
  } catch (error) {
    console.error("Error fetching custom LLM models:", error);
    throw new Error(
      `Failed to fetch custom LLM models: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}
