import type { EntityContent, EntityType } from "./types";

/**
 * Recursively extract plain text from a Tiptap JSON document.
 * Handles null/undefined (returns ""), plain string input (returns as-is),
 * and the stringified-TipTap-doc shape some upstream paths emit.
 *
 * The stringified shape is real: certain Prisma queries (and some DB
 * drivers' Json column handling) hand TipTap content back as a JSON
 * string instead of a parsed object. Without the parse fallback below,
 * the auto-tag LLM prompt would see entire steps as `Step: {"type":"doc",
 * "content":[...]}` instead of `Step: Click Forgot Password`, bloating
 * tokens and losing the actual signal.
 */
export function extractTiptapText(json: unknown): string {
  if (json == null) return "";
  if (typeof json === "string") {
    const trimmed = json.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        return extractTiptapText(JSON.parse(trimmed));
      } catch {
        // Not actually JSON; treat as the plain string we received.
      }
    }
    return json;
  }
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
    return parts
      .join(" ")
      .replace(/\s{2,}/g, " ")
      .trim();
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
 * Format one linked Issue row as a single prompt line for the auto-tag LLM,
 * or return null when the row carries no useful signal. The shape mirrors
 * what's persisted by SyncService.create/updateExistingIssue plus what
 * JiraAdapter.mapJiraIssue extracts (labels + components in `data`).
 *
 * Field selection rationale:
 * - externalKey + title give the model human-readable context.
 * - issueTypeName + priority + externalStatus are categorical signals
 *   that map cleanly to tags ("bug", "p1", "regression"…).
 * - labels + components are pre-made taxonomy from the tracker and are
 *   often the highest-leverage signal — they ARE tags.
 *
 * `description` is intentionally excluded: it's verbose, low-marginal-
 * signal relative to title + labels + components, and would dominate the
 * per-issue token budget for cases with many linked issues.
 */
export function formatLinkedIssueLine(issue: {
  externalKey?: string | null;
  title?: string | null;
  priority?: string | null;
  issueTypeName?: string | null;
  externalStatus?: string | null;
  data?: unknown;
}): string | null {
  const key = issue.externalKey?.trim();
  const title = issue.title?.trim();
  if (!key && !title) return null;

  const meta: string[] = [];
  if (issue.issueTypeName?.trim()) meta.push(issue.issueTypeName.trim());
  if (issue.priority?.trim()) meta.push(`${issue.priority.trim()} priority`);
  if (issue.externalStatus?.trim()) meta.push(issue.externalStatus.trim());

  const dataObj =
    issue.data && typeof issue.data === "object"
      ? (issue.data as Record<string, unknown>)
      : {};
  const labels = Array.isArray(dataObj.labels)
    ? (dataObj.labels as unknown[]).filter(
        (l): l is string => typeof l === "string" && l.trim() !== ""
      )
    : [];
  const components = Array.isArray(dataObj.components)
    ? (dataObj.components as unknown[]).filter(
        (c): c is string => typeof c === "string" && c.trim() !== ""
      )
    : [];

  const identifier = key ?? "(linked)";
  const head = meta.length
    ? `Linked issue ${identifier} (${meta.join(", ")})`
    : `Linked issue ${identifier}`;
  const titlePart = title ? `: "${title}"` : "";
  const labelsPart = labels.length ? ` [labels: ${labels.join(", ")}]` : "";
  const componentsPart = components.length
    ? ` [components: ${components.join(", ")}]`
    : "";

  return `${head}${titlePart}${labelsPart}${componentsPart}`;
}

/** Builds one prompt line per linked issue; drops issues that yield no signal. */
function extractLinkedIssuesText(issues: unknown): string[] {
  if (!Array.isArray(issues)) return [];
  return issues
    .map((issue) =>
      issue && typeof issue === "object"
        ? formatLinkedIssueLine(issue as any)
        : null
    )
    .filter((line): line is string => line !== null);
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
  folderPath?: string
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
        existingTagNames = entity.tags.map((t: any) => t.name ?? String(t));
      }

      // Linked-issue context (Jira labels/components are pre-made taxonomy
      // and often the strongest signal for tag suggestions).
      textParts.push(...extractLinkedIssuesText(entity.issues));
      break;
    }

    case "testRun": {
      textParts.push(name);
      const note = extractTiptapText(entity.note);
      if (note) textParts.push(note);
      const docs = extractTiptapText(entity.docs);
      if (docs) textParts.push(docs);

      if (Array.isArray(entity.tags)) {
        existingTagNames = entity.tags.map((t: any) => t.name ?? String(t));
      }

      textParts.push(...extractLinkedIssuesText(entity.issues));
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
        existingTagNames = entity.tags.map((t: any) => t.name ?? String(t));
      }

      textParts.push(...extractLinkedIssuesText(entity.issues));
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
