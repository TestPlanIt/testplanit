import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { provider, apiKey, endpoint } = await request.json();

    if (!provider) {
      return NextResponse.json(
        { success: false, error: "Provider is required" },
        { status: 400 }
      );
    }

    let models: string[] = [];

    switch (provider) {
      case "OPENAI":
        models = await fetchOpenAiModels(apiKey, endpoint);
        break;
      case "GEMINI":
        models = await fetchGeminiModels(apiKey, endpoint);
        break;
      case "ANTHROPIC":
        models = await fetchAnthropicModels(apiKey, endpoint);
        break;
      case "OLLAMA":
        models = await fetchOllamaModels(endpoint);
        break;
      default:
        return NextResponse.json(
          { success: false, error: `Unsupported provider: ${provider}` },
          { status: 400 }
        );
    }

    return NextResponse.json({
      success: true,
      models: models,
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

async function fetchOpenAiModels(
  apiKey?: string,
  endpoint?: string
): Promise<string[]> {
  if (!apiKey) {
    throw new Error("API key is required for OpenAI");
  }

  const baseUrl = endpoint?.trim() || "https://api.openai.com/v1";
  const url = `${baseUrl.replace(/\/$/, "")}/models`;

  try {
    const response = await fetch(url, {
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

    const data = await response.json();

    if (data?.data && Array.isArray(data.data)) {
      return data.data
        .map((model: any) => model?.id)
        .filter(
          (id: unknown): id is string =>
            typeof id === "string" && id.includes("gpt")
        )
        .sort();
    }

    return [];
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
): Promise<string[]> {
  if (!apiKey) {
    throw new Error("API key is required for Gemini");
  }

  const baseUrl =
    endpoint || "https://generativelanguage.googleapis.com/v1beta";
  const url = `${baseUrl}/models?key=${apiKey}`;

  try {
    const response = await fetch(url, {
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
      return data.models
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
    }

    return [];
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
): Promise<string[]> {
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
      response = await fetch(`${baseUrl}/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(10000),
      });
    } else {
      // Direct Anthropic API uses x-api-key auth
      response = await fetch(`${baseUrl}/models?limit=1000`, {
        method: "GET",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: AbortSignal.timeout(10000),
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();

    if (data?.data && Array.isArray(data.data)) {
      return data.data
        .map((model: any) => model?.id)
        .filter((id: unknown): id is string => typeof id === "string")
        .sort();
    }

    return [];
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

async function fetchOllamaModels(endpoint?: string): Promise<string[]> {
  if (!endpoint?.trim()) {
    throw new Error("Endpoint URL is required for Ollama");
  }
  const baseUrl = endpoint.trim();
  const url = `${baseUrl}/api/tags`;

  try {
    const response = await fetch(url, {
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

    // Extract model names from the response
    if (data.models && Array.isArray(data.models)) {
      return data.models
        .map((model: any) => model.name || model.model)
        .filter((name: string) => name) // Remove any undefined/null names
        .sort();
    }

    return [];
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
