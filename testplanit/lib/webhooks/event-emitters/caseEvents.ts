import type { Prisma } from "@prisma/client";

import { computeObjectDiff } from "~/lib/webhooks/diff";
import { webhookEvents } from "~/lib/webhooks/events";

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

export async function emitCaseCreated(
  row: RepositoryCaseRow,
  tx: Prisma.TransactionClient,
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
      caseFieldValues: true,
      steps: true,
    },
  });
  if (!fullCase) return;

  await webhookEvents.emit(
    "case.created",
    {
      id: fullCase.id,
      projectId: fullCase.projectId,
      name: fullCase.name,
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
  tx: Prisma.TransactionClient,
  opts: EmitOptions = {}
): Promise<void> {
  if (!oldRow) return;

  const diff = computeObjectDiff(
    oldRow as unknown as Record<string, unknown>,
    newRow as unknown as Record<string, unknown>
  );
  if (diff.changedFields.length === 0) return;

  await webhookEvents.emit(
    "case.updated",
    {
      id: newRow.id,
      projectId: newRow.projectId,
      name: newRow.name,
      after: newRow,
      diff,
    },
    {
      projectId: opts.projectId ?? newRow.projectId,
      tx,
      actorUserId: opts.actorUserId,
    }
  );
}

export async function emitCaseDeleted(
  oldRow: RepositoryCaseRow,
  tx: Prisma.TransactionClient,
  opts: EmitOptions = {}
): Promise<void> {
  await webhookEvents.emit(
    "case.deleted",
    {
      id: oldRow.id,
      name: oldRow.name,
      projectId: oldRow.projectId,
    },
    {
      projectId: opts.projectId ?? oldRow.projectId,
      tx,
      actorUserId: opts.actorUserId,
    }
  );
}
