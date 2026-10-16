import { z } from "zod";

/**
 * The link and id a CI job reports for itself (`run started`, `run finish`).
 * Same bounds the dispatch adapters apply to what a provider answers.
 */
export const externalUrlSchema = z
  .string()
  .max(2000)
  .refine((value) => {
    try {
      const u = new URL(value);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }, "externalUrl must be an http(s) URL");

export const externalRunIdSchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).slice(0, 200))
  .refine((value) => value.length > 0, "externalRunId must not be empty");

export const externalLinkFields = {
  externalUrl: externalUrlSchema.optional(),
  externalRunId: externalRunIdSchema.optional(),
};

/** The columns to write for whatever the job reported; nothing when it reported nothing. */
export function externalLinkPatch(body: {
  externalUrl?: string;
  externalRunId?: string;
}): { externalUrl?: string; externalRunId?: string } {
  return {
    ...(body.externalUrl !== undefined
      ? { externalUrl: body.externalUrl }
      : {}),
    ...(body.externalRunId !== undefined
      ? { externalRunId: body.externalRunId }
      : {}),
  };
}
