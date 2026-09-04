/**
 * Model capability lookups (context window sizing).
 *
 * The QuickScript repo-context budget must be sized from the model's *input*
 * context window, NOT from `LlmProviderConfig.defaultMaxTokens` (which is an
 * output-token default). Reusing the output field as a context budget is what
 * silently starved QuickScript when an admin left it at a small value.
 *
 * This is a plain module (no server-only imports) so the admin LLM modals can
 * reuse `getModelContextWindow` to surface the derived budget to users.
 */

/**
 * Best-effort input context window (in tokens) for a provider + model. Values
 * are conservative — when a model isn't recognized we fall back to a safe
 * per-provider default so the derived budget never overflows the real window.
 *
 * Self-hosted providers (Ollama, Custom) get a small default on purpose: their
 * context length varies widely and overflowing it is a hard request failure.
 */
export function getModelContextWindow(
  provider?: string | null,
  model?: string | null
): number {
  const m = (model ?? "").toLowerCase();
  switch (provider) {
    case "ANTHROPIC":
      // claude-3.x (incl. claude-3-5-*) = 200K; modern Claude (Opus 4.x,
      // Sonnet 4.6/5, Haiku 4.5, Fable) = 1M, except Haiku which is 200K.
      if (m.includes("haiku")) return 200_000;
      if (m.startsWith("claude-3")) return 200_000;
      if (m.includes("opus") || m.includes("sonnet") || m.includes("fable")) {
        return 1_000_000;
      }
      return 200_000;
    case "GEMINI":
      return 1_048_576; // 1.5 / 2.x / 3.x all expose ~1M input
    case "DEEPSEEK":
      // V4 (deepseek-v4-*) exposes ~1M input; the legacy deepseek-chat /
      // deepseek-reasoner aliases were 128K.
      if (m.includes("v4")) return 1_000_000;
      return 128_000;
    case "OPENAI":
    case "AZURE_OPENAI":
      if (m.includes("gpt-4.1") || m.includes("gpt-4-1")) return 1_000_000;
      if (m.startsWith("o1") || m.startsWith("o3")) return 200_000;
      return 128_000; // gpt-4o, gpt-4-turbo, and unknown OpenAI models
    case "OLLAMA":
    case "CUSTOM_LLM":
      return 8_192; // conservative — self-hosted context length varies
    default:
      return 8_192;
  }
}

/**
 * Absolute cap on the repo-context budget. Even on 1M-context models we don't
 * pour hundreds of thousands of tokens of code into every generation — input
 * tokens are billed and over-stuffing dilutes the relevant files. This is the
 * "generous but bounded" default that admins used to have to discover by
 * hand-setting defaultMaxTokens.
 */
export const MAX_QUICKSCRIPT_CONTEXT_BUDGET_TOKENS = 64_000;

/**
 * Fraction of the model's input window we're willing to dedicate to repo
 * context — the remainder is reserved for the system prompt, case data, and
 * the generated output. Binds only for small-context models; for large ones
 * the absolute cap above wins.
 */
const CONTEXT_WINDOW_FRACTION = 0.5;

/**
 * Repo-context token budget for QuickScript generation, derived from the
 * model's context window and clamped so it can never overflow that window
 * (which would 400) nor run away in cost on very-large-context models.
 */
export function getQuickScriptContextBudget(
  provider?: string | null,
  model?: string | null
): number {
  const window = getModelContextWindow(provider, model);
  return Math.min(
    MAX_QUICKSCRIPT_CONTEXT_BUDGET_TOKENS,
    Math.floor(window * CONTEXT_WINDOW_FRACTION)
  );
}

/**
 * Whether a provider + model accepts image input. A per-integration manual
 * override (`settings.modelCapabilities[model].supportsVision`) always wins;
 * otherwise best-effort name heuristics in the style of
 * `getModelContextWindow`. Deliberately conservative for self-hosted
 * providers: a text-only model receiving image parts is a hard request
 * failure, whereas a false negative just skips images with a notice.
 */
export function modelSupportsVision(
  provider?: string | null,
  model?: string | null,
  settings?: SettingsForVision | null
): boolean {
  const m = (model ?? "").toLowerCase();

  const override = model
    ? settings?.modelCapabilities?.[model]?.supportsVision
    : undefined;
  if (typeof override === "boolean") return override;

  switch (provider) {
    case "ANTHROPIC":
      return true; // every claude-3+ model is multimodal
    case "GEMINI":
      return true; // 1.5/2.x/3.x are all multimodal
    case "DEEPSEEK":
      // Only the experimental vision variant accepts images.
      return m.includes("vision");
    case "OPENAI":
    case "AZURE_OPENAI":
      // Vision-capable families; embeddings/audio/gpt-3.5 are not.
      if (m.includes("gpt-3.5")) return false;
      if (m.includes("embedding") || m.includes("audio") || m.includes("tts")) {
        return false;
      }
      return (
        m.includes("gpt-4o") ||
        m.includes("gpt-4.1") ||
        m.includes("gpt-4-1") ||
        m.includes("gpt-4-turbo") ||
        m.includes("gpt-5") ||
        m.startsWith("o1") ||
        m.startsWith("o3") ||
        m.includes("omni") ||
        m.includes("vision")
      );
    case "OLLAMA":
      return /llava|vision|(^|[^a-z])vl([^a-z]|$)|gemma3|minicpm-v|moondream|bakllava|pixtral|mistral-small3/.test(
        m
      );
    case "CUSTOM_LLM":
    default:
      return false; // unknown API shape — opt in via override only
  }
}

/**
 * Structural slice of `LlmProviderConfig.settings` this module needs.
 * Declared locally (rather than importing `SettingsWithCapabilities`) so the
 * module keeps its no-server-imports property and stays usable from admin
 * client components.
 */
interface SettingsForVision {
  modelCapabilities?: Record<
    string,
    { supportsVision?: boolean } | undefined
  > | null;
}

/**
 * Compact token-count label for the admin UI — 64000 → "64K", 1000000 → "1M".
 */
export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}
