import type { TxClient } from "~/lib/zenstack";

import { formatRecordKey, RECORD_TYPES } from "~/lib/recordKey";
import { readRecordKeyConfig } from "~/lib/services/recordKeyConfig";
import { computeObjectDiff } from "~/lib/webhooks/diff";
import { webhookEvents } from "~/lib/webhooks/events";
import {
  formatFieldValue,
  resolveCaseScalarChanges,
  type OptionFieldMeta,
} from "~/lib/webhooks/event-emitters/caseChangeResolve";

/**
 * Emit per-mutation outbound webhook events for the RepositoryCases (test
 * case) model.
 *
 * Catalog: case.created / case.updated / case.deleted.
 *
 * Payload contracts:
 *   - case.created ships the FULL case structure: caseFieldValues and steps
 *     included. This is a deliberate trade-off vs the "id-only + refetch"
 *     Qase pattern: the inbox formatter (Slack) needs more than just an id
 *     to render a meaningful card, and pushing the payload at emit-time
 *     avoids a per-event GET that would need its own auth path.
 *   - case.updated carries a generic diff. No-op updates are skipped so we
 *     don't spam destinations on policy-pass paths.
 *   - case.deleted carries the pre-delete snapshot (id + name).
 *
 * Alias-limit caveat: the create-event fetch joins repositoryCase ->
 * caseFieldValues + steps. If the ZenStack v3 alias-limit issue surfaces,
 * fall back to two separate findMany calls (the same workaround used at
 * many call sites in the codebase per ZenStack v3 migration learnings).
 */

export interface RepositoryCaseRow {
  id: number;
  projectId: number;
  name: string;
  templateId?: number | null;
  folderId?: number | null;
  repositoryId?: number | null;
  className?: string | null;
  stateId?: number | null;
  estimate?: number | null;
  forecastManual?: number | null;
  forecastAutomated?: number | null;
  automated?: boolean | null;
  isArchived?: boolean | null;
  isDeleted?: boolean | null;
  source?: string | null;
}

interface EmitOptions {
  projectId?: number;
  actorUserId?: string | null;
}

/**
 * Derive the cosmetic `TEST_CASE` display key (e.g. `WEB-TC-1234`) for a case
 * whose row we already hold but whose project `key` we don't. Reads the
 * record-key config, and only when the feature is enabled does it spend a
 * single AppConfig-scoped project lookup. Returns `null` when the feature is
 * disabled or the project has no key configured — callers fall back to the
 * bare numeric id.
 */
async function resolveCaseDisplayKey(
  tx: TxClient,
  projectId: number,
  id: number
): Promise<string | null> {
  const { enabled, tokens } = await readRecordKeyConfig(tx);
  if (!enabled) return null;
  const project = await tx.projects.findUnique({
    where: { id: projectId },
    select: { key: true },
  });
  return formatRecordKey({
    projectKey: project?.key ?? null,
    type: RECORD_TYPES.TEST_CASE,
    id,
    tokens,
  });
}

export async function emitCaseCreated(
  row: RepositoryCaseRow,
  tx: TxClient,
  opts: EmitOptions = {}
): Promise<void> {
  // Fetch the full case structure (fields + steps) so the consumer can
  // render a self-contained card without a refetch.
  const fullCase = await tx.repositoryCases.findUnique({
    where: { id: row.id },
    select: {
      id: true,
      projectId: true,
      name: true,
      className: true,
      automated: true,
      stateId: true,
      state: { select: { name: true, color: { select: { value: true } } } },
      templateId: true,
      project: { select: { key: true } },
      caseFieldValues: true,
      steps: true,
    },
  });
  if (!fullCase) return;

  const { enabled, tokens } = await readRecordKeyConfig(tx);
  const displayKey = enabled
    ? formatRecordKey({
        projectKey: fullCase.project?.key ?? null,
        type: RECORD_TYPES.TEST_CASE,
        id: fullCase.id,
        tokens,
      })
    : null;

  await webhookEvents.emit(
    "case.created",
    {
      id: fullCase.id,
      projectId: fullCase.projectId,
      name: fullCase.name,
      displayKey,
      className: fullCase.className ?? null,
      automated: fullCase.automated ?? false,
      stateId: fullCase.stateId,
      stateName: fullCase.state?.name ?? null,
      stateColor: fullCase.state?.color?.value ?? null,
      templateId: fullCase.templateId,
      fields: fullCase.caseFieldValues ?? [],
      steps: fullCase.steps ?? [],
    },
    {
      projectId: opts.projectId ?? fullCase.projectId,
      tx,
      actorUserId: opts.actorUserId,
    }
  );
}

export async function emitCaseUpdated(
  oldRow: RepositoryCaseRow | null,
  newRow: RepositoryCaseRow,
  tx: TxClient,
  opts: EmitOptions = {}
): Promise<void> {
  if (!oldRow) return;

  const diff = computeObjectDiff(
    oldRow as unknown as Record<string, unknown>,
    newRow as unknown as Record<string, unknown>
  );
  if (diff.changedFields.length === 0) return;

  // Resolve every changed column to a display-ready row: foreign keys
  // (stateId, folderId, ...) become names, bookkeeping columns
  // (currentVersion, order, ...) are dropped. When nothing user-meaningful
  // changed (e.g. a bare currentVersion bump from a field-value save), the
  // resolved set is empty and we skip the emit so destinations aren't spammed.
  const changes = await resolveCaseScalarChanges(tx, diff);
  if (changes.length === 0) return;

  const displayKey = await resolveCaseDisplayKey(
    tx,
    newRow.projectId,
    newRow.id
  );

  await webhookEvents.emit(
    "case.updated",
    {
      id: newRow.id,
      projectId: newRow.projectId,
      name: newRow.name,
      displayKey,
      after: newRow,
      diff,
      changes,
    },
    {
      projectId: opts.projectId ?? newRow.projectId,
      tx,
      actorUserId: opts.actorUserId,
    }
  );
}

/** Bare CaseFieldValues row as captured by the webhook pre/post snapshots. */
export interface CaseFieldValueRow {
  id: number;
  testCaseId: number;
  fieldId: number;
  value: unknown;
}

/**
 * Emit `case.updated` for a custom field value change. Custom field values
 * live in a separate table (CaseFieldValues) and are saved through their own
 * mutations, so they never appear in the scalar case diff — this is the only
 * path that surfaces a dropdown / multi-select / text field edit on a case.
 *
 * Option-backed values (Dropdown / Multi-Select / Checkbox) are resolved from
 * stored option ids to their labels before emit. A no-op (same display value)
 * is skipped so a re-save that rewrites the same value doesn't fire.
 */
export async function emitCaseFieldValueChanged(
  oldRow: CaseFieldValueRow | null,
  newRow: CaseFieldValueRow | null,
  tx: TxClient,
  opts: EmitOptions = {}
): Promise<void> {
  const row = newRow ?? oldRow;
  if (!row || row.testCaseId == null || row.fieldId == null) return;

  const oldValue = oldRow ? oldRow.value : null;
  const newValue = newRow ? newRow.value : null;
  if (JSON.stringify(oldValue ?? null) === JSON.stringify(newValue ?? null)) {
    return;
  }

  const [caseRow, field] = await Promise.all([
    tx.repositoryCases.findUnique({
      where: { id: row.testCaseId },
      select: {
        id: true,
        name: true,
        projectId: true,
        isDeleted: true,
        project: { select: { key: true } },
      },
    }),
    tx.caseFields.findUnique({
      where: { id: row.fieldId },
      select: {
        displayName: true,
        type: { select: { type: true } },
        fieldOptions: {
          where: { fieldOption: { isDeleted: false } },
          select: { fieldOption: { select: { id: true, name: true } } },
        },
      },
    }),
  ]);
  if (!caseRow || caseRow.isDeleted || !field) return;

  const meta = field as unknown as OptionFieldMeta;
  const from = formatFieldValue(oldValue, meta);
  const to = formatFieldValue(newValue, meta);
  if (from === to) return;

  const { enabled, tokens } = await readRecordKeyConfig(tx);
  const displayKey = enabled
    ? formatRecordKey({
        projectKey: caseRow.project?.key ?? null,
        type: RECORD_TYPES.TEST_CASE,
        id: caseRow.id,
        tokens,
      })
    : null;

  await webhookEvents.emit(
    "case.updated",
    {
      id: caseRow.id,
      projectId: caseRow.projectId,
      name: caseRow.name,
      displayKey,
      fieldChange: {
        fieldId: row.fieldId,
        fieldName: field.displayName,
        before: oldValue,
        after: newValue,
      },
      changes: [{ label: field.displayName, from, to }],
    },
    {
      projectId: opts.projectId ?? caseRow.projectId,
      tx,
      actorUserId: opts.actorUserId,
    }
  );
}

export async function emitCaseDeleted(
  oldRow: RepositoryCaseRow,
  tx: TxClient,
  opts: EmitOptions = {}
): Promise<void> {
  const displayKey = await resolveCaseDisplayKey(
    tx,
    oldRow.projectId,
    oldRow.id
  );
  await webhookEvents.emit(
    "case.deleted",
    {
      id: oldRow.id,
      name: oldRow.name,
      projectId: oldRow.projectId,
      displayKey,
    },
    {
      projectId: opts.projectId ?? oldRow.projectId,
      tx,
      actorUserId: opts.actorUserId,
    }
  );
}
