import { OpenAIAdapter } from "./openai.adapter";
import type { LlmAdapterConfig, LlmModelInfo } from "../types";

interface AzureOpenAISettings {
  deploymentName?: string;
  apiVersion?: string;
}

export class AzureOpenAIAdapter extends OpenAIAdapter {
  private deploymentName: string;
  private apiVersion: string;
  private resourceName: string;

  constructor(config: LlmAdapterConfig) {
    const azureEndpoint = config.baseUrl || "";
    const settings = config.integration.settings as AzureOpenAISettings | null;
    const deploymentName = settings?.deploymentName || "";
    const apiVersion = settings?.apiVersion || "2024-02-01";

    if (!azureEndpoint || !deploymentName) {
      throw new Error("Azure endpoint and deployment name are required");
    }

    let parsedEndpoint: URL;
    try {
      parsedEndpoint = new URL(azureEndpoint);
    } catch {
      throw new Error("Invalid Azure endpoint URL");
    }

    if (parsedEndpoint.protocol !== "https:") {
      throw new Error("Azure endpoint must use HTTPS");
    }

    const hostname = parsedEndpoint.hostname.toLowerCase();
    // Restrict to Azure OpenAI endpoints to prevent SSRF
    if (!hostname.endsWith(".openai.azure.com")) {
      throw new Error("Azure endpoint hostname is not a valid Azure OpenAI endpoint");
    }

    const resourceName = hostname.split(".")[0];

   const normalizedEndpoint = parsedEndpoint.origin;

    const azureConfig: LlmAdapterConfig = {
      ...config,
      baseUrl: `${normalizedEndpoint}/openai/deployments/${deploymentName}`,
    };

    super(azureConfig);

    this.deploymentName = deploymentName;
    this.apiVersion = apiVersion;
    this.resourceName = resourceName;
  }

  getProviderName(): string {
    return "Azure OpenAI";
  }

  protected getOpenAIHeaders(): Record<string, string> {
    const headers = this.getHeaders();
    headers["api-key"] = this.config.apiKey || "";
    // Azure uses api-key header instead of Authorization
    return headers;
  }

  protected getChatCompletionsUrl(): string {
    return `${this.config.baseUrl}/chat/completions?api-version=${this.apiVersion}`;
  }

  async getAvailableModels(): Promise<LlmModelInfo[]> {
    return this.getAzureModels();
  }

  private getAzureModels(): LlmModelInfo[] {
    const deploymentToModel: Record<string, string> = {
      "gpt-4": "gpt-4",
      "gpt-4-turbo": "gpt-4-turbo-preview",
      "gpt-4o": "gpt-4o",
      "gpt-35-turbo": "gpt-3.5-turbo",
      "gpt-35-turbo-16k": "gpt-3.5-turbo-16k",
    };

    const modelId =
      deploymentToModel[this.deploymentName] || this.deploymentName;

    const modelConfigs: Record<string, Partial<LlmModelInfo>> = {
      "gpt-4": {
        name: "GPT-4 (Azure)",
        contextWindow: 8192,
        maxOutputTokens: 4096,
        inputCostPer1k: 0.03,
        outputCostPer1k: 0.06,
        capabilities: ["text", "code"],
      },
      "gpt-4-turbo-preview": {
        name: "GPT-4 Turbo (Azure)",
        contextWindow: 128000,
        maxOutputTokens: 4096,
        inputCostPer1k: 0.01,
        outputCostPer1k: 0.03,
        capabilities: ["text", "code", "vision"],
      },
      "gpt-4o": {
        name: "GPT-4o (Azure)",
        contextWindow: 128000,
        maxOutputTokens: 4096,
        inputCostPer1k: 0.005,
        outputCostPer1k: 0.015,
        capabilities: ["text", "code", "vision"],
      },
      "gpt-3.5-turbo": {
        name: "GPT-3.5 Turbo (Azure)",
        contextWindow: 4096,
        maxOutputTokens: 4096,
        inputCostPer1k: 0.0005,
        outputCostPer1k: 0.0015,
        capabilities: ["text", "code"],
      },
      "gpt-3.5-turbo-16k": {
        name: "GPT-3.5 Turbo 16K (Azure)",
        contextWindow: 16384,
        maxOutputTokens: 4096,
        inputCostPer1k: 0.003,
        outputCostPer1k: 0.004,
        capabilities: ["text", "code"],
      },
    };

    const config = modelConfigs[modelId] || {
      name: `${this.deploymentName} (Azure)`,
      contextWindow: 4096,
      maxOutputTokens: 4096,
      capabilities: ["text"],
    };

    return [
      {
        id: this.deploymentName,
        name: config.name || this.deploymentName,
        contextWindow: config.contextWindow || 4096,
        maxOutputTokens: config.maxOutputTokens || 4096,
        inputCostPer1k: config.inputCostPer1k,
        outputCostPer1k: config.outputCostPer1k,
        capabilities: config.capabilities,
      },
    ];
  }

  private static readonly AZURE_OPENAI_DOMAIN = ".openai.azure.com";

  private validateAndSanitizeUrl(urlString: string): string | null {
    try {
      const url = new URL(urlString);
      if (url.protocol !== "https:") {
        return null;
      }
      const hostname = url.hostname.toLowerCase();
      if (!hostname.endsWith(AzureOpenAIAdapter.AZURE_OPENAI_DOMAIN)) {
        return null;
      }
      // Reconstruct URL from validated components to break taint tracking
      return `https://${hostname}${url.pathname}${url.search}`;
    } catch {
      return null;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const sanitizedUrl = this.validateAndSanitizeUrl(this.getChatCompletionsUrl());
      if (!sanitizedUrl) {
        return false;
      }

      const response = await fetch(sanitizedUrl, {
        method: "POST",
        headers: this.getOpenAIHeaders(),
        body: JSON.stringify({
          messages: [{ role: "user", content: "test" }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(5000),
      });

      return response.status === 200 || response.status === 400;
    } catch {
      return false;
    }
  }

  protected extractErrorMessage(error: any): string {
    if (error?.error?.message) {
      return error.error.message;
    }
    if (error?.message) {
      return error.message;
    }
    return "Unknown Azure OpenAI error";
  }
}
