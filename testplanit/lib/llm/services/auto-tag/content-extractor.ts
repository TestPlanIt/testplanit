import type { EntityContent, EntityType } from "./types";

/**
 * Recursively extract plain text from a Tiptap JSON document.
 * Handles null/undefined (returns "") and plain string input (returns as-is).
 */
export function extractTiptapText(json: unknown): string {
  if (json == null) return "";
  if (typeof json === "string") return json;
  if (typeof json !== "object") return String(json);

  const node = json as Record<string, unknown>;

  // Leaf text node
  if (node.type === "text" && typeof node.text === "string") {
    return node.text;
  }

  // Recurse into content array
  if (Array.isArray(node.content)) {
    const parts = (node.content as unknown[])
      .map((child) => extractTiptapText(child))
      .filter(Boolean);
    // Join inline text nodes (within same block) without extra spaces
    // The text nodes already contain their own spacing
    return parts.join(" ").replace(/\s{2,}/g, " ").trim();
  }

  return "";
}

/**
 * Extract a display value from a field value's Json payload.
 * Handles string, number, boolean, arrays (joined), objects (stringified), and null.
 */
export function extractFieldValue(fieldValue: {
  value: unknown;
  field?: { name?: string };
}): string {
  const val = fieldValue.value;
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (Array.isArray(val)) return val.map(String).join(", ");
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

/**
 * Extract all relevant content from a raw entity (with Prisma includes) into
 * a plain-text EntityContent suitable for LLM consumption.
 *
 * @param entity  Raw entity object from a Prisma query (with relations included)
 * @param entityType  One of "repositoryCase" | "testRun" | "session"
 * @param folderPath  Optional folder path string for repository cases (e.g., "Login / Admin")
 */
export function extractEntityContent(
  entity: any,
  entityType: EntityType,
  folderPath?: string,
): EntityContent {
  const id: number = entity.id;
  const name: string = entity.name ?? "";
  let textParts: string[] = [];
  let existingTagNames: string[] = [];

  switch (entityType) {
    case "repositoryCase": {
      if (folderPath) textParts.push(`Folder: ${folderPath}`);
      textParts.push(name);

      // Steps
      if (Array.isArray(entity.steps)) {
        for (const step of entity.steps) {
          const stepText = extractTiptapText(step.step);
          const expected = extractTiptapText(step.expectedResult);
          if (stepText) textParts.push(`Step: ${stepText}`);
          if (expected) textParts.push(`Expected: ${expected}`);
        }
      }

      // Case field values
      if (Array.isArray(entity.caseFieldValues)) {
        for (const cfv of entity.caseFieldValues) {
          const val = extractFieldValue(cfv);
          if (val) {
            const fieldName = cfv.field?.name ?? "Field";
            textParts.push(`${fieldName}: ${val}`);
          }
        }
      }

      // Tags
      if (Array.isArray(entity.tags)) {
        existingTagNames = entity.tags.map(
          (t: any) => t.name ?? String(t),
        );
      }
      break;
    }

    case "testRun": {
      textParts.push(name);
      const note = extractTiptapText(entity.note);
      if (note) textParts.push(note);
      const docs = extractTiptapText(entity.docs);
      if (docs) textParts.push(docs);

      if (Array.isArray(entity.tags)) {
        existingTagNames = entity.tags.map(
          (t: any) => t.name ?? String(t),
        );
      }
      break;
    }

    case "session": {
      textParts.push(name);
      const sessionNote = extractTiptapText(entity.note);
      if (sessionNote) textParts.push(sessionNote);
      const mission = extractTiptapText(entity.mission);
      if (mission) textParts.push(mission);

      // Session field values
      if (Array.isArray(entity.sessionFieldValues)) {
        for (const sfv of entity.sessionFieldValues) {
          const val = extractFieldValue(sfv);
          if (val) {
            const fieldName = sfv.field?.name ?? "Field";
            textParts.push(`${fieldName}: ${val}`);
          }
        }
      }

      if (Array.isArray(entity.tags)) {
        existingTagNames = entity.tags.map(
          (t: any) => t.name ?? String(t),
        );
      }
      break;
    }
  }

  const textContent = textParts.filter(Boolean).join("\n");
  const estimatedTokens = Math.ceil(textContent.length / 4);

  return {
    id,
    entityType,
    name,
    textContent,
    existingTagNames,
    estimatedTokens,
  };
}
