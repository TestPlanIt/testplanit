import {
  AnthropicAdapter,
  AzureOpenAIAdapter,
  CustomLlmAdapter,
  GeminiAdapter,
  OllamaAdapter,
  OpenAIAdapter,
} from "@/lib/llm/adapters";
import type { LlmAdapterConfig } from "@/lib/llm/types";
import { Decimal } from "decimal.js";
import type { JsonValue } from "@zenstackhq/orm";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "~/server/auth";

export async function POST(request: NextRequest) {
  // Test credentials endpoint called

  try {
    const session = await getServerSession(authOptions);
    // Checking session

    if (!session?.user) {
      // No session found
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin
    if (session.user.access !== "ADMIN") {
      // User is not admin
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { provider, apiKey, endpoint, deploymentName, defaultModel } = body;

    // Testing credentials for provider

    // Create a temporary config for testing
    const testConfig: LlmAdapterConfig = {
      integration: {
        id: 0,
        name: "Test",
        provider,
        status: "ACTIVE",
        credentials: {
          apiKey,
          endpoint,
          baseUrl: endpoint,
        },
        settings: {
          deploymentName,
          apiVersion: provider === "AZURE_OPENAI" ? "2024-02-01" : undefined,
        } as JsonValue,
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      config: {
        id: 0,
        llmIntegrationId: null,
        defaultModel: defaultModel || "test",
        availableModels: {},
        maxTokensPerRequest: 4096,
        maxRequestsPerMinute: 60,
        maxRequestsPerDay: null,
        costPerInputToken: new Decimal(0),
        costPerOutputToken: new Decimal(0),
        defaultTemperature: 0.7,
        defaultMaxTokens: 1000,
        timeout: 10000,
        retryAttempts: 1,
        streamingEnabled: true,
        isDefault: false,
        monthlyBudget: new Decimal(0),
        billingPeriodStartDay: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        settings: {},
        alertThresholdsFired: null,
      },
      apiKey,
      baseUrl: endpoint,
    };

    let adapter;
    try {
      switch (provider) {
        case "OPENAI":
          adapter = new OpenAIAdapter(testConfig);
          break;
        case "ANTHROPIC":
          adapter = new AnthropicAdapter(testConfig);
          break;
        case "AZURE_OPENAI":
          adapter = new AzureOpenAIAdapter(testConfig);
          break;
        case "GEMINI":
          adapter = new GeminiAdapter(testConfig);
          break;
        case "OLLAMA":
          adapter = new OllamaAdapter(testConfig);
          break;
        case "CUSTOM_LLM":
          adapter = new CustomLlmAdapter(testConfig);
          break;
        default:
          throw new Error(`Unsupported provider: ${provider}`);
      }

      // Testing connection with adapter
      const isConnected = await adapter.testConnection();
      // Connection test result obtained

      if (!isConnected) {
        // The adapter records the real failure reason (HTTP status + provider
        // message) when it can; prefer it over the generic fallback so admins
        // see what actually went wrong (bad key, model not permitted, etc.).
        const detail = adapter.getLastTestConnectionError();
        if (detail) {
          console.warn("Test connection failed for %s: %s", provider, detail);
        }

        // Try to provide more specific error messages
        let errorMessage: string;

        if (provider === "OPENAI" && !apiKey) {
          errorMessage = "API key is required for OpenAI";
        } else if (provider === "ANTHROPIC" && !apiKey) {
          errorMessage = "API key is required for Anthropic";
        } else if (
          provider === "AZURE_OPENAI" &&
          (!apiKey || !deploymentName)
        ) {
          errorMessage =
            "API key and deployment name are required for Azure OpenAI";
        } else if (provider === "GEMINI" && !apiKey) {
          errorMessage = "API key is required for Google Gemini";
        } else if (provider === "OLLAMA") {
          errorMessage = `Failed to connect to Ollama at ${endpoint || "http://localhost:11434"}. Make sure Ollama is running.`;
        } else if (!endpoint) {
          errorMessage = "Endpoint URL is required";
        } else if (detail) {
          errorMessage = `Failed to connect to ${provider}: ${detail}`;
        } else {
          errorMessage = `Failed to connect to ${provider}. Please check your credentials and endpoint.`;
        }

        return NextResponse.json({
          success: false,
          error: errorMessage,
        });
      }

      // Probe the model for parameter support so future chat requests
      // skip params the model rejects (e.g. temperature on Anthropic
      // adaptive-thinking models). Failure to probe is non-fatal — connection
      // already succeeded, and the runtime fallback in each adapter will
      // catch any rejections on the first real request.
      let modelCapabilities: Record<
        string,
        { unsupportedParams: string[]; probedAt: string }
      > | null = null;
      if (defaultModel) {
        try {
          const capabilities =
            await adapter.probeModelCapabilities(defaultModel);
          modelCapabilities = { [defaultModel]: capabilities };
        } catch (probeError) {
          console.warn(
            "Capability probe failed for %s/%s; continuing without persisted capabilities:",
            provider,
            defaultModel,
            probeError
          );
        }
      }

      // Returning success response
      return NextResponse.json({
        success: true,
        message: "Connection successful!",
        modelCapabilities,
      });
    } catch (error) {
      console.error("Error testing credentials:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Failed to test credentials";
      return NextResponse.json({
        success: false,
        error: errorMessage,
      });
    }
  } catch (error) {
    console.error("Error in test-credentials:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
