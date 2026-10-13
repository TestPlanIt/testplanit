/**
 * Coerce an LLM text response into a parseable JSON object string: slice
 * from the first `{` to the last `}` so markdown fences, unmatched fence
 * openers, and surrounding prose are dropped. Falls back to the trimmed
 * input when no brace pair is found so the parse error keeps a preview.
 */
export function stripCodeFence(input: string): string {
  const trimmed = input.trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

/** The `{...}` span of the response after fence stripping, or null when absent. */
export function extractJsonObject(text: string): string | null {
  const stripped = stripCodeFence(text);
  return stripped.startsWith("{") && stripped.endsWith("}") ? stripped : null;
}
