import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { Prisma } from "@prisma/client";
import {
  OpenAIAdapter,
  AnthropicAdapter,
  AzureOpenAIAdapter,
  GeminiAdapter,
  OllamaAdapter,
  CustomLlmAdapter,
} from "@/lib/llm/adapters";
import type { LlmAdapterConfig } from "@/lib/llm/types";

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
    const { provider, apiKey, endpoint, deploymentName } = body;

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
        },
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      config: {
        id: 0,
        llmIntegrationId: null,
        defaultModel: "test",
        availableModels: {},
        maxTokensPerRequest: 4096,
        maxRequestsPerMinute: 60,
        maxRequestsPerDay: null,
        costPerInputToken: new Prisma.Decimal(0),
        costPerOutputToken: new Prisma.Decimal(0),
        defaultTemperature: 0.7,
        defaultMaxTokens: 1000,
        timeout: 10000,
        retryAttempts: 1,
        streamingEnabled: true,
        isDefault: false,
        monthlyBudget: new Prisma.Decimal(0),
        createdAt: new Date(),
        updatedAt: new Date(),
        settings: {},
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
        // Try to provide more specific error messages
        let errorMessage = "Failed to connect to the provider";

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
        } else {
          errorMessage = `Failed to connect to ${provider}. Please check your credentials and endpoint.`;
        }

        return NextResponse.json({
          success: false,
          error: errorMessage,
        });
      }

      // Returning success response
      return NextResponse.json({
        success: true,
        message: "Connection successful!",
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
