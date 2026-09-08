/**
 * Helpers for the multimodal `LlmMessage.content` union
 * (`string | LlmContentPart[]`).
 *
 * Adapters and budget code must never assume `content` is a string; these
 * helpers are the single place that knows how to flatten, filter, and
 * estimate the union. Plain module (no server-only imports) so both API
 * routes and client-adjacent code can use it.
 */

import type { LlmContentPart, LlmImagePart, LlmMessage } from "~/lib/llm/types";

/**
 * Fixed per-image prompt-token estimate used wherever we budget with the
 * chars/4 heuristic. Providers bill images by resolution tiles (Anthropic
 * ≈ w*h/750, OpenAI detail tiles); without decoding dimensions we charge a
 * conservative flat rate near the high end of a full-screen screenshot.
 */
export const IMAGE_TOKEN_ESTIMATE = 1600;

/**
 * Flatten message content to plain text. Image parts become a short
 * `[image: <label>]` marker so text-only models (and log lines) still see
 * that an image existed at that position instead of silently losing it.
 */
export function flattenToText(content: string | LlmContentPart[]): string {
  if (typeof content === "string") return content;
  return content
    .map((part) =>
      part.type === "text"
        ? part.text
        : `[image: ${part.filename ?? "attached image"}]`
    )
    .join("\n");
}

/** The image parts of a message's content ([] for plain strings). */
export function contentImages(
  content: string | LlmContentPart[]
): LlmImagePart[] {
  if (typeof content === "string") return [];
  return content.filter((part): part is LlmImagePart => part.type === "image");
}

/** Total image parts across a message list. */
export function countImages(messages: LlmMessage[]): number {
  return messages.reduce(
    (sum, message) => sum + contentImages(message.content).length,
    0
  );
}

/**
 * Replace every parts-array content with its flattened string. Used by
 * adapters (and the feature-layer vision gate) to send a text-only request
 * without touching the original message objects.
 */
export function stripImages(messages: LlmMessage[]): LlmMessage[] {
  return messages.map((message) =>
    typeof message.content === "string"
      ? message
      : { ...message, content: flattenToText(message.content) }
  );
}

/**
 * Prompt-token estimate for a message list: the established chars/4
 * heuristic over the flattened text plus a flat per-image charge. Keeps
 * image-bearing requests visible to budget loops and streaming usage
 * tracking, which otherwise see images as ~0 characters.
 */
export function estimatePromptTokens(messages: LlmMessage[]): number {
  return messages.reduce((sum, message) => {
    const textTokens = Math.ceil(flattenToText(message.content).length / 4);
    const imageTokens =
      contentImages(message.content).length * IMAGE_TOKEN_ESTIMATE;
    return sum + textTokens + imageTokens;
  }, 0);
}
