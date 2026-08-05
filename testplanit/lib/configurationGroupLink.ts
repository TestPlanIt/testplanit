/**
 * Save-path helpers for the configuration-group link control on the test run
 * and session edit forms.
 *
 * The control itself never writes; it hands the page a
 * {@link ConfigurationGroupLinkChange}-shaped intent and the page persists it.
 * The awkward bits of that persistence live here so they can be tested without
 * rendering a 2,400-line page:
 *
 *   - the field slice EVERY save path must include (the run edit form has two
 *     near-identical `updateTestRuns` call sites — one for the cases-changed
 *     path, one for metadata-only — and a field added to only one of them
 *     silently no-ops on the other);
 *   - stamping a peer that had no group yet, with a rollback so a failed peer
 *     write can't strand this record alone in a group nobody joined;
 *   - who may edit membership at all.
 */

/** Field write for one record. */
export interface ConfigurationGroupUpdateData {
  configurationGroupId: string | null;
}

/**
 * The `configurationGroupId` slice of a run/session update payload.
 *
 * Spread into every save path rather than typed out per call site: the run edit
 * form writes the same record from two branches, and only a shared builder
 * makes it structurally impossible for one of them to drop the field.
 */
export function configurationGroupUpdateData(
  groupId: string | null | undefined
): ConfigurationGroupUpdateData {
  return { configurationGroupId: groupId ?? null };
}

/**
 * A group edit is staged in the form and written by Save, so the control is
 * only offered where a Save exists. Completed runs and sessions render no
 * Save, which is why completion closes the control here.
 *
 * The multi-configuration aggregate view is excluded because "this record" is
 * ambiguous while several members are selected at once.
 */
export function canEditConfigurationGroup(args: {
  canAddEdit: boolean;
  isMultiConfigurationView?: boolean;
  isCompleted?: boolean;
}): boolean {
  return (
    !!args.canAddEdit && !args.isMultiConfigurationView && !args.isCompleted
  );
}

type GroupUpdateFn = (args: {
  where: { id: number };
  data: ConfigurationGroupUpdateData;
}) => Promise<unknown>;

/**
 * Stamp the peer a join minted a fresh group id for.
 *
 * Linking A to a peer B that had no group mints one uuid for BOTH records. The
 * record being edited is written by its own save path; this writes B. If that
 * write fails, A is rolled back to the group it held before — otherwise A sits
 * alone in a brand-new group, and a lone member still renders as
 * "multi-configuration" at every badge site.
 *
 * A no-op when the change didn't mint anything (the peer was already in a
 * group, or the change was an unlink).
 */
export async function applyConfigurationGroupPeerStamp(args: {
  update: GroupUpdateFn;
  recordId: number;
  groupId: string | null;
  stampTargetId: number | null;
  previousGroupId: string | null;
}): Promise<void> {
  const { update, recordId, groupId, stampTargetId, previousGroupId } = args;
  if (stampTargetId === null || !groupId) return;
  if (stampTargetId === recordId) return;
  try {
    await update({
      where: { id: stampTargetId },
      data: configurationGroupUpdateData(groupId),
    });
  } catch (error) {
    await update({
      where: { id: recordId },
      data: configurationGroupUpdateData(previousGroupId),
    }).catch(() => {
      // The rollback is best-effort; surface the original failure either way.
    });
    throw error;
  }
}
