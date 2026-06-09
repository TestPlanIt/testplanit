import { toHumanReadable } from "~/utils/duration";

/**
 * Resolve a test case's raw diff into display-ready change rows for the
 * `case.updated` webhook.
 *
 * All resolution happens at EMIT time (where DB access exists) so the Slack
 * formatter can stay a pure renderer. Every foreign-key column is resolved to
 * the referenced record's display name ("stateId: 14 → 11" becomes
 * "State: Active → Draft"); option-backed custom fields resolve their stored
 * option ids to labels; internal/bookkeeping columns are hidden.
 */

export interface ResolvedChange {
  /** Human label, e.g. "State", "Folder", "Priority". */
  label: string;
  /** Display value before the change (null = unset). */
  from: string | null;
  /** Display value after the change (null = unset). */
  to: string | null;
  /** Optional hex color carried by the change (state color → Slack bar). */
  color?: string | null;
}

/**
 * Foreign-key columns on RepositoryCases and how to resolve each id to a
 * display name. `repositoryId` is intentionally absent — the Repositories
 * model has no name column (it's the per-project container). `tx` is the
 * Prisma transaction client (typed `any`, as the webhook hooks are).
 */
const FK_RESOLVERS: Record<
  string,
  {
    label: string;
    resolve: (
      tx: any,
      id: number | string
    ) => Promise<{ name: string | null; color?: string | null } | null>;
  }
> = {
  stateId: {
    label: "State",
    resolve: async (tx, id) => {
      const r = await tx.workflows.findUnique({
        where: { id },
        select: { name: true, color: { select: { value: true } } },
      });
      return r ? { name: r.name, color: r.color?.value ?? null } : null;
    },
  },
  folderId: {
    label: "Folder",
    resolve: async (tx, id) => {
      const r = await tx.repositoryFolders.findUnique({
        where: { id },
        select: { name: true },
      });
      return r ? { name: r.name } : null;
    },
  },
  templateId: {
    label: "Template",
    resolve: async (tx, id) => {
      const r = await tx.templates.findUnique({
        where: { id },
        select: { templateName: true },
      });
      return r ? { name: r.templateName } : null;
    },
  },
  creatorId: {
    label: "Created by",
    resolve: async (tx, id) => {
      const r = await tx.user.findUnique({
        where: { id },
        select: { name: true },
      });
      return r ? { name: r.name } : null;
    },
  },
  projectId: {
    label: "Project",
    resolve: async (tx, id) => {
      const r = await tx.projects.findUnique({
        where: { id },
        select: { name: true },
      });
      return r ? { name: r.name } : null;
    },
  },
};

/** Bookkeeping columns that carry no meaning to a webhook reader. */
const HIDDEN_FIELDS = new Set([
  "id",
  "order",
  "createdAt",
  "updatedAt",
  "currentVersion",
  "hasParameters",
  "repositoryId",
  "forecastManual",
  "forecastAutomated",
]);

const SCALAR_LABELS: Record<string, string> = {
  name: "Name",
  className: "Class",
  source: "Source",
  estimate: "Estimate",
  automated: "Automated",
  isArchived: "Archived",
  isDeleted: "Deleted",
};

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/** camelCase column → "Title case" label, dropping a trailing "Id". */
function prettyLabel(field: string): string {
  const spaced = field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\bId\b/g, "")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatScalar(field: string, v: unknown): string {
  if (v === undefined || v === null) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (field === "estimate" && typeof v === "number") {
    return v > 0 ? toHumanReadable(v, { isSeconds: true }) : "0";
  }
  if (typeof v === "string") return truncate(v, 80) || "—";
  return truncate(String(v), 80);
}

/**
 * Turn a top-level scalar diff (`{changedFields, before, after}`) into
 * display-ready rows, resolving every foreign-key column to a name and
 * dropping bookkeeping columns.
 */
export async function resolveCaseScalarChanges(
  tx: any,
  diff: {
    changedFields: string[];
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }
): Promise<ResolvedChange[]> {
  const changes: ResolvedChange[] = [];
  for (const field of diff.changedFields) {
    if (HIDDEN_FIELDS.has(field)) continue;
    const before = diff.before[field] ?? null;
    const after = diff.after[field] ?? null;

    const fk = FK_RESOLVERS[field];
    if (fk) {
      const [fromR, toR] = await Promise.all([
        before != null
          ? fk.resolve(tx, before as number | string).catch(() => null)
          : null,
        after != null
          ? fk.resolve(tx, after as number | string).catch(() => null)
          : null,
      ]);
      changes.push({
        label: fk.label,
        from: fromR?.name ?? (before != null ? `#${before}` : null),
        to: toR?.name ?? (after != null ? `#${after}` : null),
        color: toR?.color ?? null,
      });
      continue;
    }

    changes.push({
      label: SCALAR_LABELS[field] ?? prettyLabel(field),
      from: formatScalar(field, before),
      to: formatScalar(field, after),
    });
  }
  return changes;
}

/** Field metadata needed to resolve option ids to labels. */
export interface OptionFieldMeta {
  displayName: string;
  type: { type: string } | null;
  fieldOptions: Array<{ fieldOption: { id: number; name: string } }>;
}

/**
 * For option-backed field types (Dropdown / Multi-Select / Checkbox) the
 * stored value is a FieldOption id (or array of ids). Resolve to the
 * option's display name(s). Other types pass through unchanged. Mirrors
 * lib/services/reports/automationCandidatesContext.ts::resolveFieldValue so
 * the LLM context and the webhook never disagree on how a value reads.
 */
function resolveOptionIds(value: unknown, field: OptionFieldMeta): unknown {
  const typeName = field.type?.type;
  const isOptionType =
    typeName === "Dropdown" ||
    typeName === "Multi-Select" ||
    typeName === "Checkbox";
  if (!isOptionType || field.fieldOptions.length === 0) return value;

  const optionNameById = new Map<number, string>();
  for (const a of field.fieldOptions) {
    optionNameById.set(a.fieldOption.id, a.fieldOption.name);
  }
  const resolveOne = (raw: unknown): unknown => {
    if (typeof raw === "number") return optionNameById.get(raw) ?? raw;
    if (typeof raw === "string" && /^\d+$/.test(raw)) {
      return optionNameById.get(Number(raw)) ?? raw;
    }
    return raw;
  };
  return Array.isArray(value) ? value.map(resolveOne) : resolveOne(value);
}

/** Resolve a stored field value to a single display string. */
export function formatFieldValue(
  value: unknown,
  field: OptionFieldMeta
): string {
  const resolved = resolveOptionIds(value, field);
  if (resolved === undefined || resolved === null) return "—";
  if (Array.isArray(resolved)) {
    return resolved.length ? resolved.map((v) => String(v)).join(", ") : "—";
  }
  const s = String(resolved);
  return s.trim() === "" ? "—" : truncate(s, 120);
}
