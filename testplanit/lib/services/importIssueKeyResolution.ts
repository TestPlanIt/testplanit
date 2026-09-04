import { DEFECT_SCOPE_WHERE } from "~/lib/services/issueRoleScope";
import {
  IssueKeyResolutionError,
  resolveIssueKeys,
} from "~/lib/services/resolveIssueKeys";

/**
 * Batch half of the import's `issues` column: take every name the file
 * mentions, and for the ones no local row answers to, resolve them upstream as
 * tracker keys.
 *
 * Runs once per import rather than once per row, so a thousand-case file that
 * cites forty tickets makes forty tracker calls, not a thousand. Everything it
 * produces is advisory — an import whose integration is missing, ambiguous, or
 * unreachable still imports its cases, and simply reports which cells it could
 * not place.
 *
 * ## Why a resolved key can still be refused
 *
 * The column is defect-scoped by design (see `importCaseIssueLinks`): a
 * requirement is authored on the requirements surfaces, and `replaceExisting`
 * deliberately clears only the links this column authored. A key that resolves
 * to a requirement row therefore gets an explanation instead of a link — the
 * alternative writes a link no later import can clean up.
 */

export interface ImportIssueNameClient {
  issue: {
    findFirst(args: {
      where: Record<string, unknown>;
      select?: Record<string, unknown>;
    }): Promise<{ id: number } | null>;
  };
}

export interface ImportIssueKeyResolutionResult {
  /** Name → local Issue id, for names resolved upstream this run. */
  idsByName: Map<string, number>;
  /** Name → why it could not be linked, for everything still unplaced. */
  errorsByName: Map<string, string>;
}

export interface ResolveImportIssueKeysOptions {
  projectId: number;
  /** Every name the file's `issues` cells mention, duplicates included. */
  names: string[];
  integrationId?: number;
}

export async function resolveImportIssueKeys(
  db: ImportIssueNameClient,
  { projectId, names, integrationId }: ResolveImportIssueKeysOptions
): Promise<ImportIssueKeyResolutionResult> {
  const idsByName = new Map<string, number>();
  const errorsByName = new Map<string, string>();

  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (unique.length === 0) return { idsByName, errorsByName };

  // Names an existing local row already answers to are not tracker keys as far
  // as this import is concerned — the linker resolves those itself.
  const unresolved: string[] = [];
  for (const name of unique) {
    const local = await db.issue.findFirst({
      where: {
        name,
        isDeleted: false,
        projectId,
        ...DEFECT_SCOPE_WHERE,
      },
      select: { id: true },
    });
    if (!local) unresolved.push(name);
  }
  if (unresolved.length === 0) return { idsByName, errorsByName };

  let resolved;
  try {
    resolved = await resolveIssueKeys({
      projectId,
      keys: unresolved,
      integrationId,
    });
  } catch (error) {
    // No integration, or more than one to choose from: every unresolved name
    // gets the same explanation, and the import proceeds without those links.
    const message =
      error instanceof IssueKeyResolutionError
        ? error.message
        : "Failed to resolve issue keys against the tracker.";
    for (const name of unresolved) {
      errorsByName.set(
        name,
        `No issue named "${name}" in this project. ${message}`
      );
    }
    return { idsByName, errorsByName };
  }

  for (const name of unresolved) {
    const resolution = resolved.get(name);
    if (resolution?.issueId == null) {
      errorsByName.set(
        name,
        `No issue named "${name}" in this project, and it could not be resolved as a tracker key — ${resolution?.error ?? "not found."}`
      );
      continue;
    }

    // Re-read under the defect scope: the resolved row may be classified as a
    // requirement, which this column does not author links to.
    const defect = await db.issue.findFirst({
      where: {
        id: resolution.issueId,
        isDeleted: false,
        projectId,
        ...DEFECT_SCOPE_WHERE,
      },
      select: { id: true },
    });
    if (!defect) {
      errorsByName.set(
        name,
        `"${name}" is tracked as a requirement, not a defect. Link it from the requirements surface — the import's issues column only links defects.`
      );
      continue;
    }

    idsByName.set(name, defect.id);
  }

  return { idsByName, errorsByName };
}
