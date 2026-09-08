/**
 * Helpers shared by the configuration switchers on the test run and session
 * pages.
 *
 * Group membership (`configurationGroupId`) is editable after creation, so the
 * switchers cannot assume a stable set of members, and two members of the same
 * group may legitimately share one configuration.
 */

export type ConfigurationGroupMember = {
  id: number;
  name: string;
  configuration?: { id: number; name: string } | null;
};

/**
 * `where` clause for the sibling query behind a configuration switcher.
 *
 * Every member of a group belongs to the same project, so the query is scoped
 * to the viewed entity's project: a hand-written or stale group id must never
 * pull in a run or session from another project the viewer happens to have
 * access to.
 *
 * The clause is only meaningful together with
 * {@link isConfigurationGroupQueryEnabled}; when either id is missing the
 * filter degrades to `isDeleted: false` and the query must stay disabled.
 */
export function buildConfigurationGroupWhere(args: {
  configurationGroupId: string | null | undefined;
  projectId: number | null | undefined;
}): {
  configurationGroupId: string | undefined;
  projectId: number | undefined;
  isDeleted: false;
} {
  return {
    configurationGroupId: args.configurationGroupId ?? undefined,
    projectId: args.projectId ?? undefined,
    isDeleted: false,
  };
}

/** True when both the group id and the project scope are known. */
export function isConfigurationGroupQueryEnabled(args: {
  configurationGroupId: string | null | undefined;
  projectId: number | null | undefined;
}): boolean {
  return (
    !!args.configurationGroupId &&
    typeof args.projectId === "number" &&
    Number.isFinite(args.projectId)
  );
}

/** Route segment (a string) to the project id the sibling query is scoped to. */
export function parseProjectIdParam(
  value: string | string[] | null | undefined
): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function configurationKey(member: ConfigurationGroupMember): string {
  return (member.configuration?.name ?? "").trim().toLowerCase();
}

/**
 * Human label for every member of a group, keyed by member id.
 *
 * Members are labelled by their configuration, which reads best when the group
 * has one member per configuration — the common case. The configuration name
 * alone is ambiguous when two members share it, and useless when a member has
 * no configuration at all; those members get their own name appended so each
 * entry in the switcher stays identifiable.
 */
export function buildConfigurationGroupMemberLabels<
  T extends ConfigurationGroupMember,
>(
  members: readonly T[],
  format: {
    /** Label for a member with no configuration. */
    noConfiguration: string;
    /** Combines a configuration label with the member's own name. */
    withMemberName: (values: { configuration: string; name: string }) => string;
  }
): Map<number, string> {
  const counts = new Map<string, number>();
  for (const member of members) {
    const key = configurationKey(member);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const labels = new Map<number, string>();
  for (const member of members) {
    const key = configurationKey(member);
    const hasConfiguration = key.length > 0;
    const configuration = hasConfiguration
      ? member.configuration!.name.trim()
      : format.noConfiguration;
    const isAmbiguous = !hasConfiguration || (counts.get(key) ?? 0) > 1;
    labels.set(
      member.id,
      isAmbiguous
        ? format.withMemberName({ configuration, name: member.name })
        : configuration
    );
  }
  return labels;
}

/**
 * Drops selected members that are no longer part of the group and refreshes the
 * survivors from the latest member data. Members that joined the group are
 * never added to the selection on the user's behalf.
 *
 * Returns the `selection` argument itself when nothing changed so callers can
 * skip a state update with a reference check.
 */
export function reconcileConfigurationSelection<T extends { id: number }>(
  selection: readonly T[],
  members: readonly T[]
): readonly T[] {
  const byId = new Map(members.map((member) => [member.id, member]));
  const next = selection
    .map((selected) => byId.get(selected.id))
    .filter((member): member is T => member !== undefined);

  const unchanged =
    next.length === selection.length &&
    next.every((member, index) => member === selection[index]);

  return unchanged ? selection : next;
}

/**
 * Resolves the ids in a `?configs=` URL parameter against actual group
 * membership. Ids that are not members are dropped, so an injected or stale run
 * id can never widen what the page reads.
 */
export function resolveSelectionFromUrl<T extends { id: number }>(
  members: readonly T[],
  idsFromUrl: readonly number[] | null | undefined
): T[] {
  if (!idsFromUrl || idsFromUrl.length === 0) return [];
  const wanted = new Set(idsFromUrl);
  return members.filter((member) => wanted.has(member.id));
}
