/**
 * Strip markdown code fences from LLM output.
 * Models sometimes wrap responses in ```lang ... ``` despite being told not to.
 */
export function stripMarkdownFences(code: string): string {
  return code
    .replace(/^```[\w]*\r?\n?/, "")
    .replace(/\r?\n?```\s*$/, "")
    .trim();
}

/**
 * Build a human-readable error string from a caught value, including the
 * cause chain so "fetch failed" surfaces the underlying reason (e.g. ECONNREFUSED).
 */
export function formatAiError(err: unknown): string {
  if (!(err instanceof Error)) return "AI generation failed";

  const parts: string[] = [err.message];
  let cause = (err as { cause?: unknown }).cause;
  while (cause) {
    if (cause instanceof Error) {
      parts.push(cause.message);
      cause = (cause as { cause?: unknown }).cause;
    } else if (
      typeof cause === "object" &&
      cause !== null &&
      "code" in cause
    ) {
      parts.push(String((cause as { code: unknown }).code));
      break;
    } else {
      break;
    }
  }
  return parts.filter(Boolean).join(": ");
}
