/**
 * Classify why an LLM response could not be turned into test-case JSON.
 *
 * Shared by the outline and expand routes so both surface the same
 * actionable `details` / `suggestions` to the wizard. The provider's finish
 * reason is the primary signal: an empty response with `length` means the
 * output budget ran out before any text was produced (models that think
 * before answering, such as Claude Opus 5, spend part of that budget on
 * reasoning), and `content_filter` means the provider declined.
 */
export interface LlmParseFailureClassification {
  code: "generic";
  details: string;
  suggestions: string[];
}

export function classifyLlmParseFailure(input: {
  raw: string;
  finishReason: string | undefined;
  errMsg: string;
}): LlmParseFailureClassification {
  const { raw, finishReason, errMsg } = input;
  const trimmed = (raw ?? "").trim();

  if (!trimmed) {
    if (finishReason === "length") {
      return {
        code: "generic",
        details:
          "The model hit its max-output-tokens limit before producing any text. Models that reason before answering spend part of the output budget on thinking, so a small limit can leave no room for the response.",
        suggestions: [
          "Raise the model's max-output-tokens in LLM settings",
          "Shorten the issue description or testing guidance",
          'Try a smaller quantity (e.g. "Few" instead of "Many")',
        ],
      };
    }
    if (finishReason === "content_filter") {
      return {
        code: "generic",
        details:
          "The model declined to respond — the provider's safety filter stopped the request before any text was produced.",
        suggestions: [
          "Rephrase the issue description or testing guidance",
          "Remove any content that might look like instructions to the model",
          "Try a different model — providers have different safety thresholds",
        ],
      };
    }
    return {
      code: "generic",
      details:
        "The model returned an empty response. This is usually transient or a connectivity issue with the provider.",
      suggestions: [
        "Try again — empty responses are typically transient",
        "Check the LLM integration's status page",
        "Verify the model and API key in LLM settings",
      ],
    };
  }

  const refusalMarkers = [
    "i cannot",
    "i can't",
    "i am unable",
    "i'm unable",
    "i'm not able",
    "sorry,",
    "as an ai",
  ];
  const lower = trimmed.toLowerCase();
  if (refusalMarkers.some((m) => lower.includes(m)) && !lower.includes("{")) {
    return {
      code: "generic",
      details:
        "The model returned a refusal or explanatory text instead of JSON. The issue content may have triggered safety filters or the prompt may be unclear.",
      suggestions: [
        "Rephrase the issue description or testing guidance",
        "Try a different model — providers have different safety thresholds",
        "Remove any content that might look like instructions to the model",
      ],
    };
  }

  if (
    finishReason === "length" ||
    errMsg.includes("Unexpected end") ||
    (!trimmed.endsWith("}") && !trimmed.endsWith("]"))
  ) {
    return {
      code: "generic",
      details: `The model's response was cut off before it finished${
        finishReason === "length" ? " (hit the max-tokens limit)" : ""
      }. The JSON was incomplete and could not be parsed.`,
      suggestions: [
        'Try a smaller quantity (e.g. "Few" instead of "Many")',
        "Shorten the issue description or testing guidance",
        "Raise the model's max-output-tokens in LLM settings",
      ],
    };
  }

  return {
    code: "generic",
    details: `The model returned text but its JSON could not be parsed (${errMsg}). The response preview is included for debugging.`,
    suggestions: [
      "Try again — JSON-format slips are often transient",
      "Switch to a model with stronger JSON adherence (e.g. with native JSON mode)",
      "Check server logs for the full raw response",
    ],
  };
}
