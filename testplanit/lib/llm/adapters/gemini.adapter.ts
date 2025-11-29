import { BaseLlmAdapter } from "./base.adapter";
import type {
  LlmRequest,
  LlmResponse,
  LlmStreamResponse,
  LlmModelInfo,
  RateLimitInfo,
  LlmAdapterConfig,
} from "../types";

interface GeminiMessage {
  role: "user" | "model";
  parts: Array<{
    text: string;
  }>;
}

interface GeminiGenerateRequest {
  contents: GeminiMessage[];
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    topK?: number;
    stopSequences?: string[];
  };
  safetySettings?: Array<{
    category: string;
    threshold: string;
  }>;
}

interface GeminiGenerateResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
      role: string;
    };
    finishReason: string;
    index: number;
    safetyRatings: Array<{
      category: string;
      probability: string;
    }>;
  }>;
  usageMetadata: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

interface GeminiStreamResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
      role: string;
    };
    finishReason?: string;
    index: number;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

export class GeminiAdapter extends BaseLlmAdapter {
  private apiKey: string;
  private baseUrl: string;
  private modelName: string;

  constructor(config: LlmAdapterConfig) {
    super(config);
    this.apiKey = config.apiKey || "";
    this.baseUrl = config.baseUrl || "https://generativelanguage.googleapis.com/v1beta";
    this.modelName = config.config.defaultModel || "gemini-1.5-flash";

    if (!this.apiKey) {
      throw this.createError(
        "Google Gemini API key is required",
        "MISSING_API_KEY",
        401
      );
    }
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
    this.validateRequest(request);

    const model = request.model || this.getDefaultModel();
    const contents = this.convertMessagesToGeminiFormat(request.messages);

    const geminiRequest: GeminiGenerateRequest = {
      contents,
      generationConfig: {
        temperature: request.temperature ?? this.config.config.defaultTemperature,
        maxOutputTokens: request.maxTokens ?? this.config.config.defaultMaxTokens,
        topP: 0.95,
        topK: 64,
      },
      safetySettings: [
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "BLOCK_MEDIUM_AND_ABOVE"
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          threshold: "BLOCK_MEDIUM_AND_ABOVE"
        },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_MEDIUM_AND_ABOVE"
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_MEDIUM_AND_ABOVE"
        }
      ],
    };

    try {
      const response = await fetch(`${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(geminiRequest),
        signal: AbortSignal.timeout(this.getTimeout()),
      });

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      const data = (await response.json()) as GeminiGenerateResponse;

      if (!data.candidates || data.candidates.length === 0) {
        throw this.createError(
          "No candidates returned from Gemini",
          "NO_CANDIDATES",
          500
        );
      }

      const candidate = data.candidates[0];
      
      // Handle different response formats from Gemini
      let content = "";
      
      // Check for specific finish reasons first
      if (candidate.finishReason === "SAFETY") {
        throw this.createError(
          "Content was blocked by Gemini safety filters. Try rephrasing your request.",
          "CONTENT_BLOCKED",
          400
        );
      }
      
      if (candidate.finishReason === "MAX_TOKENS") {
        // Handle MAX_TOKENS case - response might be truncated but still valid
        if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
          content = candidate.content.parts.map(part => part.text || "").join("");
          if (content.trim()) {
            // We have valid content, just add a note about truncation
            content += "\n\n[Response was truncated due to length limit]";
          }
        }
        
        // If we still don't have content, it's an error
        if (!content || !content.trim()) {
          const tokenLimit = request.maxTokens ?? this.config.config.defaultMaxTokens;
          throw this.createError(
            `The AI response was too long and got truncated at ${tokenLimit} tokens. Please try a shorter request, ask for a more concise response, or increase the token limit in your LLM configuration.`,
            "MAX_TOKENS",
            400
          );
        }
      }
      
      // Only process content if we haven't already handled it in special cases above
      if (!content) {
        if (candidate.content && candidate.content.parts) {
          content = candidate.content.parts.map(part => part.text || "").join("");
        } else if (candidate.content && typeof candidate.content === "string") {
          content = candidate.content;
        } else if (candidate.content === null || candidate.content === undefined) {
          // Handle empty content case - might be due to safety filtering or other issues
          throw this.createError(
            `Gemini returned empty content. Finish reason: ${candidate.finishReason}. This may be due to content filtering or an API issue.`,
            "EMPTY_CONTENT",
            400
          );
        } else {
          // Log the actual response structure for debugging
          console.error("Unexpected Gemini response structure:", JSON.stringify(candidate, null, 2));
          throw this.createError(
            `Invalid response format from Gemini - unexpected content structure. Finish reason: ${candidate.finishReason}`,
            "INVALID_RESPONSE_FORMAT",
            500
          );
        }
      }
      
      // Check if content is empty after processing
      if (!content || content.trim().length === 0) {
        throw this.createError(
          `Gemini returned empty text content. Finish reason: ${candidate.finishReason}. Please try rephrasing your request.`,
          "EMPTY_CONTENT",
          400
        );
      }

      return {
        content,
        model,
        promptTokens: data.usageMetadata.promptTokenCount,
        completionTokens: data.usageMetadata.candidatesTokenCount,
        totalTokens: data.usageMetadata.totalTokenCount,
        finishReason: this.mapFinishReason(candidate.finishReason),
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw this.createError(
          "Request timeout",
          "TIMEOUT",
          408,
          true
        );
      }
      throw error;
    }
  }

  async *chatStream(
    request: LlmRequest
  ): AsyncGenerator<LlmStreamResponse, void, unknown> {
    this.validateRequest(request);

    const model = request.model || this.getDefaultModel();
    const contents = this.convertMessagesToGeminiFormat(request.messages);

    const geminiRequest: GeminiGenerateRequest = {
      contents,
      generationConfig: {
        temperature: request.temperature ?? this.config.config.defaultTemperature,
        maxOutputTokens: request.maxTokens ?? this.config.config.defaultMaxTokens,
        topP: 0.95,
        topK: 64,
      },
      safetySettings: [
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "BLOCK_MEDIUM_AND_ABOVE"
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          threshold: "BLOCK_MEDIUM_AND_ABOVE"
        },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_MEDIUM_AND_ABOVE"
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_MEDIUM_AND_ABOVE"
        }
      ],
    };

    const response = await fetch(`${this.baseUrl}/models/${model}:streamGenerateContent?key=${this.apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(geminiRequest),
      signal: AbortSignal.timeout(this.getTimeout()),
    });

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    if (!response.body) {
      throw this.createError("No response body", "NO_RESPONSE_BODY", 500);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.trim() && !line.startsWith('data: ')) {
            continue;
          }

          const jsonStr = line.replace('data: ', '').trim();
          if (!jsonStr) continue;

          try {
            const data = JSON.parse(jsonStr) as GeminiStreamResponse;
            
            if (data.candidates && data.candidates.length > 0) {
              const candidate = data.candidates[0];
              const content = candidate.content.parts.map(part => part.text).join("");
              
              yield {
                delta: content,
                model,
                finishReason: candidate.finishReason ? this.mapFinishReason(candidate.finishReason) : undefined,
              };
            }
          } catch (parseError) {
            // Skip malformed chunks
            continue;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async getAvailableModels(): Promise<LlmModelInfo[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models?key=${this.apiKey}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      const data = await response.json();
      
      return data.models?.map((model: any) => ({
        id: model.name.replace('models/', ''),
        name: model.displayName || model.name,
        contextWindow: model.inputTokenLimit || 32768,
        maxOutputTokens: model.outputTokenLimit || 8192,
        capabilities: model.supportedGenerationMethods || [],
      })) || [];
    } catch (error) {
      console.warn("Failed to fetch Gemini models:", error);
      return this.getDefaultModels();
    }
  }

  async isModelAvailable(modelId: string): Promise<boolean> {
    const availableModels = await this.getAvailableModels();
    return availableModels.some(model => model.id === modelId);
  }

  async getRateLimitInfo(): Promise<RateLimitInfo | null> {
    // Gemini doesn't provide rate limit headers in a standardized way
    return null;
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models?key=${this.apiKey}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(5000),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("Gemini test connection error:", response.status, errorText);
      }
      
      return response.ok;
    } catch (error) {
      console.error("Gemini test connection error:", error);
      return false;
    }
  }

  private convertMessagesToGeminiFormat(messages: Array<{ role: string; content: string }>): GeminiMessage[] {
    const geminiMessages: GeminiMessage[] = [];
    
    for (const message of messages) {
      // Skip system messages for now - they need to be handled differently in Gemini
      if (message.role === "system") {
        // In Gemini, system instructions are typically added to the first user message
        continue;
      }
      
      const role = message.role === "assistant" ? "model" : "user";
      geminiMessages.push({
        role,
        parts: [{ text: message.content }],
      });
    }

    // If we have system messages, prepend them to the first user message
    const systemMessages = messages.filter(m => m.role === "system");
    if (systemMessages.length > 0 && geminiMessages.length > 0 && geminiMessages[0].role === "user") {
      const systemInstructions = systemMessages.map(m => m.content).join("\n\n");
      geminiMessages[0].parts[0].text = `${systemInstructions}\n\n${geminiMessages[0].parts[0].text}`;
    }

    return geminiMessages;
  }

  private mapFinishReason(reason: string): "stop" | "length" | "content_filter" | "error" {
    switch (reason) {
      case "STOP":
        return "stop";
      case "MAX_TOKENS":
        return "length";
      case "SAFETY":
      case "RECITATION":
        return "content_filter";
      default:
        return "error";
    }
  }

  private getDefaultModels(): LlmModelInfo[] {
    return [
      {
        id: "gemini-1.5-pro",
        name: "Gemini 1.5 Pro",
        contextWindow: 2097152,
        maxOutputTokens: 8192,
        inputCostPer1k: 0.00125,
        outputCostPer1k: 0.00375,
        capabilities: ["generateContent", "streamGenerateContent"],
      },
      {
        id: "gemini-1.5-flash",
        name: "Gemini 1.5 Flash",
        contextWindow: 1048576,
        maxOutputTokens: 8192,
        inputCostPer1k: 0.000075,
        outputCostPer1k: 0.0003,
        capabilities: ["generateContent", "streamGenerateContent"],
      },
      {
        id: "gemini-1.0-pro",
        name: "Gemini 1.0 Pro",
        contextWindow: 32768,
        maxOutputTokens: 2048,
        inputCostPer1k: 0.0005,
        outputCostPer1k: 0.0015,
        capabilities: ["generateContent", "streamGenerateContent"],
      },
    ];
  }

  getProviderName(): string {
    return "Google Gemini";
  }

  getDefaultModel(): string {
    return this.modelName;
  }

  protected extractErrorMessage(error: any): string {
    if (error?.error?.message) {
      return error.error.message;
    }
    if (error?.message) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    return "Unknown error occurred";
  }

  protected async handleErrorResponse(response: Response): Promise<never> {
    let errorMessage = `HTTP ${response.status}`;
    
    try {
      const errorData = await response.json();
      errorMessage = this.extractErrorMessage(errorData);
    } catch {
      errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    }

    throw this.createError(
      errorMessage,
      "API_ERROR",
      response.status,
      response.status >= 500 || response.status === 429
    );
  }
}