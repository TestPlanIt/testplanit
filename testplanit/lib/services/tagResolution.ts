import { baseDb } from "~/lib/db";
import { isUniqueConstraintError } from "~/lib/utils/errors";
import { sanitizeName } from "~/utils/stringUtils";

export interface ResolvedTag {
  id: number;
  name: string;
  created: boolean;
}

const findLive = (name: string) =>
  baseDb.tags.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, isDeleted: false },
    select: { id: true, name: true },
  });

/**
 * Resolve a tag name the way the web UI's tag manager does, for API writers
 * (the CLI lookup the MCP server calls, and bulk-create).
 *
 * Names match case-insensitively. A name is also tried in its cleaned form —
 * trimmed, with the characters the UI replaces (`"'/\:*?<>|`) turned into
 * `_` — and a new tag is created with the cleaned name, so " smoke" or
 * "API/Auth" land on the tag the UI would have made. A deleted case-variant
 * is restored rather than duplicated. Returns `null` for a blank name, or
 * when the tag is missing and `createIfMissing` is false.
 */
export async function resolveTagByName(
  rawName: string,
  { createIfMissing }: { createIfMissing: boolean }
): Promise<ResolvedTag | null> {
  const trimmed = rawName.trim();
  const cleaned = sanitizeName(rawName);
  if (!cleaned) return null;

  // An existing tag stored under the raw name still matches it.
  const existing =
    (trimmed ? await findLive(trimmed) : null) ??
    (cleaned !== trimmed ? await findLive(cleaned) : null);
  if (existing) return { ...existing, created: false };
  if (!createIfMissing) return null;

  const deleted = await baseDb.tags.findFirst({
    where: { name: { equals: cleaned, mode: "insensitive" }, isDeleted: true },
    select: { id: true },
  });
  try {
    const tag = deleted
      ? await baseDb.tags.update({
          where: { id: deleted.id },
          data: { isDeleted: false },
          select: { id: true, name: true },
        })
      : await baseDb.tags.create({
          data: { name: cleaned },
          select: { id: true, name: true },
        });
    return { ...tag, created: true };
  } catch (err) {
    // Another request created or restored a case-variant in between.
    if (isUniqueConstraintError(err)) {
      const raced = await findLive(cleaned);
      if (raced) return { ...raced, created: false };
    }
    throw err;
  }
}
