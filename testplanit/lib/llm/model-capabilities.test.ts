import { describe, expect, it } from "vitest";
import {
  getModelContextWindow,
  modelSupportsVision,
} from "./model-capabilities";

describe("modelSupportsVision", () => {
  it("Anthropic and Gemini are always vision-capable", () => {
    expect(modelSupportsVision("ANTHROPIC", "claude-sonnet-5")).toBe(true);
    expect(modelSupportsVision("ANTHROPIC", "claude-3-haiku")).toBe(true);
    expect(modelSupportsVision("GEMINI", "gemini-2.5-pro")).toBe(true);
  });

  it("OpenAI/Azure resolve by model family", () => {
    expect(modelSupportsVision("OPENAI", "gpt-4o")).toBe(true);
    expect(modelSupportsVision("OPENAI", "gpt-4.1-mini")).toBe(true);
    expect(modelSupportsVision("OPENAI", "gpt-5")).toBe(true);
    expect(modelSupportsVision("AZURE_OPENAI", "o3-mini")).toBe(true);
    expect(modelSupportsVision("OPENAI", "gpt-3.5-turbo")).toBe(false);
    expect(modelSupportsVision("OPENAI", "text-embedding-3-large")).toBe(false);
    expect(modelSupportsVision("OPENAI", "gpt-4o-audio-preview")).toBe(false);
    expect(modelSupportsVision("OPENAI", "some-unknown-model")).toBe(false);
  });

  it("Ollama defaults false, true only for known vision families", () => {
    expect(modelSupportsVision("OLLAMA", "llama3.1:8b")).toBe(false);
    expect(modelSupportsVision("OLLAMA", "llava:13b")).toBe(true);
    expect(modelSupportsVision("OLLAMA", "gemma3:27b")).toBe(true);
    expect(modelSupportsVision("OLLAMA", "minicpm-v")).toBe(true);
    expect(modelSupportsVision("OLLAMA", "qwen2.5-vl:7b")).toBe(true);
    // "vl" must match as a token, not inside a word.
    expect(modelSupportsVision("OLLAMA", "vladimir-model")).toBe(false);
  });

  it("DeepSeek is text-only except the experimental vision variant", () => {
    expect(modelSupportsVision("DEEPSEEK", "deepseek-v4-flash")).toBe(false);
    expect(modelSupportsVision("DEEPSEEK", "deepseek-v4-pro")).toBe(false);
    expect(modelSupportsVision("DEEPSEEK", "deepseek-chat")).toBe(false);
    expect(
      modelSupportsVision("DEEPSEEK", "deepseek-v4-flash-vision-exp")
    ).toBe(true);
  });

  it("Custom and unknown providers default false", () => {
    expect(modelSupportsVision("CUSTOM_LLM", "anything")).toBe(false);
    expect(modelSupportsVision(undefined, "gpt-4o")).toBe(false);
    expect(modelSupportsVision("CUSTOM_LLM", null)).toBe(false);
  });

  it("per-model settings override wins in both directions", () => {
    const settings = {
      modelCapabilities: {
        "my-model": { supportsVision: true },
        "gpt-4o": { supportsVision: false },
      },
    };
    expect(modelSupportsVision("CUSTOM_LLM", "my-model", settings)).toBe(true);
    expect(modelSupportsVision("OPENAI", "gpt-4o", settings)).toBe(false);
    // Models without an override fall through to heuristics.
    expect(modelSupportsVision("OPENAI", "gpt-4o-mini", settings)).toBe(true);
  });
});

describe("getModelContextWindow", () => {
  it("DeepSeek V4 is 1M, legacy aliases 128K", () => {
    expect(getModelContextWindow("DEEPSEEK", "deepseek-v4-flash")).toBe(
      1_000_000
    );
    expect(getModelContextWindow("DEEPSEEK", "deepseek-v4-pro")).toBe(
      1_000_000
    );
    expect(getModelContextWindow("DEEPSEEK", "deepseek-chat")).toBe(128_000);
    expect(getModelContextWindow("DEEPSEEK", "deepseek-reasoner")).toBe(
      128_000
    );
  });
});
