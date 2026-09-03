import { describe, expect, it } from "vitest";
import { classifyLlmParseFailure } from "./classify-parse-failure";

describe("classifyLlmParseFailure", () => {
  it("explains an empty response that hit the output-token limit", () => {
    const result = classifyLlmParseFailure({
      raw: "",
      finishReason: "length",
      errMsg: "No JSON found in response",
    });

    expect(result.code).toBe("generic");
    expect(result.details).toContain("max-output-tokens");
    expect(result.suggestions[0]).toContain("max-output-tokens");
  });

  it("explains an empty response the provider declined", () => {
    const result = classifyLlmParseFailure({
      raw: "   ",
      finishReason: "content_filter",
      errMsg: "No JSON found in response",
    });

    expect(result.details).toContain("declined");
  });

  it("treats an empty response with no finish reason as transient", () => {
    const result = classifyLlmParseFailure({
      raw: "",
      finishReason: undefined,
      errMsg: "No JSON found in response",
    });

    expect(result.details).toContain("empty response");
    expect(result.suggestions[0]).toContain("Try again");
  });

  it("flags incomplete JSON as cut off", () => {
    const result = classifyLlmParseFailure({
      raw: '{"outlines":[{"title":"a"',
      finishReason: "length",
      errMsg: "Unexpected end of JSON input",
    });

    expect(result.details).toContain("cut off");
    expect(result.details).toContain("max-tokens");
  });

  it("recognizes a prose refusal", () => {
    const result = classifyLlmParseFailure({
      raw: "I'm unable to help with that request.",
      finishReason: "stop",
      errMsg: "No JSON found in response",
    });

    expect(result.details).toContain("refusal");
  });

  it("falls back to a generic parse failure", () => {
    const result = classifyLlmParseFailure({
      raw: '{"outlines": [1, 2,]}',
      finishReason: "stop",
      errMsg: "Unexpected token ] in JSON",
    });

    expect(result.details).toContain("could not be parsed");
  });
});
