import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertAllowedUrl,
  extractEmbeddedPricing,
  fetchLiteLlmPricing,
  parseLiteLlmPricing,
  stripChatCompletionsSuffix,
} from "./pricing";

describe("assertAllowedUrl", () => {
  it("accepts http and https URLs", () => {
    expect(assertAllowedUrl("https://litellm.example.com/v1").hostname).toBe(
      "litellm.example.com"
    );
    expect(assertAllowedUrl("http://192.168.1.5:4000").hostname).toBe(
      "192.168.1.5"
    );
  });

  it("rejects non-http protocols", () => {
    expect(() => assertAllowedUrl("file:///etc/passwd")).toThrow(
      /http or https/
    );
  });

  it("rejects cloud metadata hostnames", () => {
    expect(() => assertAllowedUrl("http://169.254.169.254/latest")).toThrow(
      /not allowed/
    );
    expect(() =>
      assertAllowedUrl("http://metadata.google.internal/computeMetadata")
    ).toThrow(/not allowed/);
  });
});

describe("stripChatCompletionsSuffix", () => {
  it("strips a trailing /chat/completions", () => {
    expect(
      stripChatCompletionsSuffix(
        "https://proxy.example.com/v1/chat/completions"
      )
    ).toBe("https://proxy.example.com/v1");
  });

  it("strips trailing slashes before the suffix check", () => {
    expect(
      stripChatCompletionsSuffix(
        " https://proxy.example.com/v1/chat/completions/ "
      )
    ).toBe("https://proxy.example.com/v1");
  });

  it("leaves base URLs untouched apart from trimming", () => {
    expect(stripChatCompletionsSuffix("https://proxy.example.com/v1/")).toBe(
      "https://proxy.example.com/v1"
    );
  });
});

describe("extractEmbeddedPricing", () => {
  it("scales OpenRouter per-token string pricing to per 1M tokens", () => {
    const map = extractEmbeddedPricing([
      {
        id: "anthropic/claude-sonnet-4.5",
        pricing: { prompt: "0.0000025", completion: "0.00001", request: "0" },
      },
    ]);
    expect(map["anthropic/claude-sonnet-4.5"]).toEqual({
      input: 2.5,
      output: 10,
    });
  });

  it("keeps OpenRouter free models at zero", () => {
    const map = extractEmbeddedPricing([
      { id: "free/model", pricing: { prompt: "0", completion: "0" } },
    ]);
    expect(map["free/model"]).toEqual({ input: 0, output: 0 });
  });

  it("passes Together AI per-1M numeric pricing through unchanged", () => {
    const map = extractEmbeddedPricing([
      {
        id: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        pricing: { hourly: 0, input: 0.88, output: 0.88, cached_input: 0.6 },
      },
    ]);
    expect(map["meta-llama/Llama-3.3-70B-Instruct-Turbo"]).toEqual({
      input: 0.88,
      output: 0.88,
    });
  });

  it("skips models without pricing and malformed entries", () => {
    const map = extractEmbeddedPricing([
      { id: "gpt-4o" },
      { id: "bad", pricing: { prompt: "not-a-number", completion: "1" } },
      { pricing: { prompt: "1", completion: "1" } },
      null,
      "gpt-4o-mini",
    ]);
    expect(map).toEqual({});
  });

  it("skips negative and unstorably large values", () => {
    const map = extractEmbeddedPricing([
      { id: "negative", pricing: { input: -1, output: 1 } },
      // Decimal(10,8) tops out below $100 per 1M tokens
      { id: "too-expensive", pricing: { input: 150, output: 600 } },
      { id: "ok", pricing: { input: 15, output: 75 } },
    ]);
    expect(Object.keys(map)).toEqual(["ok"]);
  });

  it("returns an empty map for non-array payloads", () => {
    expect(extractEmbeddedPricing(undefined)).toEqual({});
    expect(extractEmbeddedPricing({ data: [] })).toEqual({});
  });
});

describe("parseLiteLlmPricing", () => {
  it("scales USD-per-token floats to per 1M tokens", () => {
    const map = parseLiteLlmPricing({
      data: [
        {
          model_name: "gpt-4o",
          litellm_params: { model: "openai/gpt-4o" },
          model_info: {
            input_cost_per_token: 0.000003,
            output_cost_per_token: 0.000007,
          },
        },
      ],
    });
    expect(map["gpt-4o"]).toEqual({ input: 3, output: 7 });
  });

  it("skips models with null or missing costs", () => {
    const map = parseLiteLlmPricing({
      data: [
        {
          model_name: "custom-model",
          model_info: {
            input_cost_per_token: null,
            output_cost_per_token: null,
          },
        },
        { model_name: "no-info" },
        { model_info: { input_cost_per_token: 1e-6 } },
      ],
    });
    expect(map).toEqual({});
  });

  it("returns an empty map for malformed payloads", () => {
    expect(parseLiteLlmPricing(null)).toEqual({});
    expect(parseLiteLlmPricing({ data: "nope" })).toEqual({});
    expect(parseLiteLlmPricing([])).toEqual({});
  });
});

describe("fetchLiteLlmPricing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches {base}/model/info with Bearer auth and parses the result", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            model_name: "claude-sonnet-4-5",
            model_info: {
              input_cost_per_token: 0.000003,
              output_cost_per_token: 0.000015,
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const map = await fetchLiteLlmPricing(
      "https://litellm.example.com/v1/",
      "sk-test"
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://litellm.example.com/v1/model/info",
      expect.objectContaining({
        headers: { Authorization: "Bearer sk-test" },
      })
    );
    expect(map["claude-sonnet-4-5"]).toEqual({ input: 3, output: 15 });
  });

  it("returns an empty map on non-OK responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(
      await fetchLiteLlmPricing("https://api.openai.com/v1", "sk-test")
    ).toEqual({});
  });

  it("returns an empty map on network errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    expect(
      await fetchLiteLlmPricing("https://litellm.example.com", "sk-test")
    ).toEqual({});
  });

  it("never fetches blocked metadata hosts", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchLiteLlmPricing("http://169.254.169.254")).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
