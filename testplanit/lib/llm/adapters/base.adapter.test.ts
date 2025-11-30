import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { BaseLlmAdapter } from "./base.adapter";
import type {
  LlmRequest,
  LlmResponse,
  LlmStreamResponse,
  LlmAdapterConfig,
  LlmModelInfo,
  RateLimitInfo,
} from "../types";

// Create a concrete implementation for testing
class TestAdapter extends BaseLlmAdapter {
  async chat(request: LlmRequest): Promise<LlmResponse> {
    this.validateRequest(request);
    return {
      content: "Test response",
      model: request.model || this.getDefaultModel(),
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    };
  }

  async *chatStream(
    request: LlmRequest
  ): AsyncGenerator<LlmStreamResponse, void, unknown> {
    this.validateRequest(request);
    yield { delta: "Test", model: "test-model" };
    yield { delta: " response", model: "test-model", finishReason: "stop" };
  }

  async getAvailableModels(): Promise<LlmModelInfo[]> {
    return [
      {
        id: "test-model",
        name: "Test Model",
        contextWindow: 4096,
        maxOutputTokens: 2048,
      },
    ];
  }

  async isModelAvailable(modelId: string): Promise<boolean> {
    return modelId === "test-model";
  }

  async getRateLimitInfo(): Promise<RateLimitInfo | null> {
    return null;
  }

  async testConnection(): Promise<boolean> {
    return true;
  }

  getProviderName(): string {
    return "TestProvider";
  }

  protected extractErrorMessage(error: any): string {
    return error?.message || "Unknown error";
  }

  // Expose protected methods for testing
  public testCreateError(
    message: string,
    code: string,
    statusCode?: number,
    retryable = false,
    details?: any
  ) {
    return this.createError(message, code, statusCode, retryable, details);
  }

  public testCalculateCost(promptTokens: number, completionTokens: number) {
    return this.calculateCost(promptTokens, completionTokens);
  }

  public testValidateRequest(request: LlmRequest) {
    return this.validateRequest(request);
  }

  public testGetHeaders() {
    return this.getHeaders();
  }
}

const createTestConfig = (
  overrides: Partial<LlmAdapterConfig> = {}
): LlmAdapterConfig => ({
  integration: {
    id: 1,
    name: "Test Integration",
    provider: "OPENAI",
    status: "ACTIVE",
    credentials: {},
    settings: null,
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  config: {
    id: 1,
    llmIntegrationId: 1,
    defaultModel: "gpt-4",
    availableModels: ["gpt-4", "gpt-3.5-turbo"],
    maxTokensPerRequest: 4096,
    maxRequestsPerMinute: 60,
    maxRequestsPerDay: null,
    costPerInputToken: new Prisma.Decimal("0.00003"),
    costPerOutputToken: new Prisma.Decimal("0.00006"),
    monthlyBudget: null,
    defaultTemperature: 0.7,
    defaultMaxTokens: 1000,
    timeout: 30000,
    retryAttempts: 3,
    streamingEnabled: false,
    isDefault: false,
    settings: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  apiKey: "test-api-key",
  ...overrides,
});

describe("BaseLlmAdapter", () => {
  let adapter: TestAdapter;
  let config: LlmAdapterConfig;

  beforeEach(() => {
    config = createTestConfig();
    adapter = new TestAdapter(config);
  });

  describe("getDefaultModel", () => {
    it("should return the default model from config", () => {
      expect(adapter.getDefaultModel()).toBe("gpt-4");
    });
  });

  describe("getTimeout", () => {
    it("should return the timeout from config", () => {
      expect(adapter.getTimeout()).toBe(30000);
    });
  });

  describe("createError", () => {
    it("should create an error with all properties", () => {
      const error = adapter.testCreateError(
        "Test error",
        "TEST_CODE",
        500,
        true,
        { extra: "data" }
      );

      expect(error.message).toBe("Test error");
      expect(error.code).toBe("TEST_CODE");
      expect(error.statusCode).toBe(500);
      expect(error.retryable).toBe(true);
      expect(error.details).toEqual({ extra: "data" });
      expect(error.provider).toBe("TestProvider");
    });

    it("should create an error with minimal properties", () => {
      const error = adapter.testCreateError("Minimal error", "MIN_CODE");

      expect(error.message).toBe("Minimal error");
      expect(error.code).toBe("MIN_CODE");
      expect(error.statusCode).toBeUndefined();
      expect(error.retryable).toBe(false);
    });
  });

  describe("calculateCost", () => {
    it("should calculate cost correctly", () => {
      const cost = adapter.testCalculateCost(1000, 500);

      // Input: 1000 tokens * 0.00003 / 1000 = 0.00003
      // Output: 500 tokens * 0.00006 / 1000 = 0.00003
      expect(cost.inputCost).toBeCloseTo(0.00003, 6);
      expect(cost.outputCost).toBeCloseTo(0.00003, 6);
      expect(cost.totalCost).toBeCloseTo(0.00006, 6);
    });

    it("should handle zero tokens", () => {
      const cost = adapter.testCalculateCost(0, 0);

      expect(cost.inputCost).toBe(0);
      expect(cost.outputCost).toBe(0);
      expect(cost.totalCost).toBe(0);
    });

    it("should handle large token counts", () => {
      const cost = adapter.testCalculateCost(100000, 50000);

      // Input: 100000 tokens * 0.00003 / 1000 = 0.003
      // Output: 50000 tokens * 0.00006 / 1000 = 0.003
      expect(cost.inputCost).toBeCloseTo(0.003, 6);
      expect(cost.outputCost).toBeCloseTo(0.003, 6);
      expect(cost.totalCost).toBeCloseTo(0.006, 6);
    });
  });

  describe("validateRequest", () => {
    it("should pass for valid request", () => {
      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      expect(() => adapter.testValidateRequest(request)).not.toThrow();
    });

    it("should throw for empty messages array", () => {
      const request: LlmRequest = {
        messages: [],
        userId: "user-123",
        feature: "test",
      };

      expect(() => adapter.testValidateRequest(request)).toThrow(
        "Messages array cannot be empty"
      );
    });

    it("should throw for undefined messages", () => {
      const request = {
        userId: "user-123",
        feature: "test",
      } as LlmRequest;

      expect(() => adapter.testValidateRequest(request)).toThrow(
        "Messages array cannot be empty"
      );
    });

    it("should throw when maxTokens exceeds limit", () => {
      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        maxTokens: 10000, // exceeds 4096 limit
        userId: "user-123",
        feature: "test",
      };

      expect(() => adapter.testValidateRequest(request)).toThrow(
        "Max tokens 10000 exceeds limit 4096"
      );
    });

    it("should allow maxTokens within limit", () => {
      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        maxTokens: 2000,
        userId: "user-123",
        feature: "test",
      };

      expect(() => adapter.testValidateRequest(request)).not.toThrow();
    });

    it("should throw for temperature below 0", () => {
      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        temperature: -0.1,
        userId: "user-123",
        feature: "test",
      };

      expect(() => adapter.testValidateRequest(request)).toThrow(
        "Temperature must be between 0 and 2"
      );
    });

    it("should throw for temperature above 2", () => {
      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        temperature: 2.5,
        userId: "user-123",
        feature: "test",
      };

      expect(() => adapter.testValidateRequest(request)).toThrow(
        "Temperature must be between 0 and 2"
      );
    });

    it("should allow temperature at boundaries", () => {
      const request1: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        temperature: 0,
        userId: "user-123",
        feature: "test",
      };

      const request2: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        temperature: 2,
        userId: "user-123",
        feature: "test",
      };

      expect(() => adapter.testValidateRequest(request1)).not.toThrow();
      expect(() => adapter.testValidateRequest(request2)).not.toThrow();
    });
  });

  describe("getHeaders", () => {
    it("should return default headers", () => {
      const headers = adapter.testGetHeaders();

      expect(headers["Content-Type"]).toBe("application/json");
    });

    it("should include additional headers from config", () => {
      const configWithHeaders = createTestConfig({
        additionalHeaders: {
          "X-Custom-Header": "custom-value",
          "X-Another-Header": "another-value",
        },
      });
      const adapterWithHeaders = new TestAdapter(configWithHeaders);

      const headers = adapterWithHeaders.testGetHeaders();

      expect(headers["Content-Type"]).toBe("application/json");
      expect(headers["X-Custom-Header"]).toBe("custom-value");
      expect(headers["X-Another-Header"]).toBe("another-value");
    });
  });

  describe("chat", () => {
    it("should return a response", async () => {
      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      const response = await adapter.chat(request);

      expect(response.content).toBe("Test response");
      expect(response.model).toBe("gpt-4");
      expect(response.totalTokens).toBe(30);
    });
  });

  describe("chatStream", () => {
    it("should yield stream responses", async () => {
      const request: LlmRequest = {
        messages: [{ role: "user", content: "Hello" }],
        userId: "user-123",
        feature: "test",
      };

      const chunks: LlmStreamResponse[] = [];
      for await (const chunk of adapter.chatStream(request)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      expect(chunks[0].delta).toBe("Test");
      expect(chunks[1].delta).toBe(" response");
      expect(chunks[1].finishReason).toBe("stop");
    });
  });

  describe("getAvailableModels", () => {
    it("should return available models", async () => {
      const models = await adapter.getAvailableModels();

      expect(models).toHaveLength(1);
      expect(models[0].id).toBe("test-model");
      expect(models[0].name).toBe("Test Model");
    });
  });

  describe("isModelAvailable", () => {
    it("should return true for available model", async () => {
      expect(await adapter.isModelAvailable("test-model")).toBe(true);
    });

    it("should return false for unavailable model", async () => {
      expect(await adapter.isModelAvailable("other-model")).toBe(false);
    });
  });

  describe("testConnection", () => {
    it("should return connection status", async () => {
      expect(await adapter.testConnection()).toBe(true);
    });
  });

  describe("getProviderName", () => {
    it("should return provider name", () => {
      expect(adapter.getProviderName()).toBe("TestProvider");
    });
  });
});
