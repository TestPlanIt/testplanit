import type { JsonValue } from "@zenstackhq/orm";
import type { TxClient } from "~/lib/zenstack";

import {
  getPerCaseIterationCounts,
  getTestRunSummary,
} from "~/lib/services/testRunSummary";
import {
  redactValues,
  type ParameterSchemaEntry,
} from "~/lib/services/parameterRedaction";
import { publishTestRunWakeUp } from "~/lib/live/publish";
import { webhookEvents } from "~/lib/webhooks/events";

/**
 * Per-value cap for parameter values emitted into webhook payloads.
 * Long values (e.g., copy-pasted JSON blobs in a test-data row) are
 * replaced with a `<value truncated: N bytes>` sentinel so a single
 * 5000-iteration run-completion payload stays bounded. 4 KB matches the
 * cap used by the `iteration.result.recorded` emitter so both surfaces
 * share one ceiling.
 */
const WEBHOOK_VALUE_MAX_BYTES = 4 * 1024;

/**
 * Replace any value whose serialized UTF-8 byte length exceeds the cap
 * with a truncated sentinel. Non-string values (nested objects, arrays)
 * are JSON-serialized before the byte check so an object-shaped parameter
 * value cannot escape the cap. Numbers, booleans, and null pass through
 * unchanged.
 */
function capValueBytes(
  values: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === "string") {
      const bytes = Buffer.byteLength(v, "utf8");
      if (bytes > WEBHOOK_VALUE_MAX_BYTES) {
        out[k] = `<value truncated: ${bytes} bytes>`;
        continue;
      }
    } else if (v !== null && typeof v === "object") {
      let serialized: string;
      try {
        serialized = JSON.stringify(v);
      } catch {
        out[k] = "<value truncated: unserializable>";
        continue;
      }
      const bytes = Buffer.byteLength(serialized, "utf8");
      if (bytes > WEBHOOK_VALUE_MAX_BYTES) {
        out[k] = `<value truncated: ${bytes} bytes>`;
        continue;
      }
    }
    out[k] = v;
  }
  return out;
}

/**
 * Coerce a Prisma `Json` parametersJson column into the narrow
 * ParameterSchemaEntry[] redaction shape.
 */
function parseParameterSchema(
  value: JsonValue | null | undefined
): ParameterSchemaEntry[] {
  if (!Array.isArray(value)) return [];
  const out: ParameterSchemaEntry[] = [];
  for (const entry of value) {
    if (
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      typeof (entry as Record<string, unknown>).name === "string"
    ) {
      const e = entry as Record<string, unknown>;
      out.push({
        name: String(e.name),
        sensitive: e.sensitive === true,
      });
    }
  }
  return out;
}

/**
 * Emit per-mutation outbound webhook events for TestRuns lifecycle.
 * Detection logic for state transitions and the "transitioned-into-
 * completed" sub-case lives here so the lib/prisma.ts `$extends`
 * middleware can stay generic.
 *
 * Every emit is bound to the caller's tx (webhookEvents.emit requires tx)
 * so the outbox row commits with the producing entity write.
 */

/** Minimal shape we read from a TestRuns row to assemble payloads. */
export interface TestRunRow {
  id: number;
  projectId: number;
  name: string;
  stateId: number | null;
  /** Source of truth for "is this run done" — flipping this triggers
   *  test_run.completed regardless of whether stateId changed. */
  isCompleted?: boolean;
}

interface EmitOptions {
  projectId?: number;
  actorUserId?: string | null;
}

export async function emitTestRunCreated(
  row: TestRunRow,
  tx: TxClient,
  opts: EmitOptions = {}
): Promise<void> {
  let stateName: string | null = null;
  let stateColor: string | null = null;
  let stateIsCompleted = false;
  if (row.stateId != null) {
    const state = await tx.workflows.findUnique({
      where: { id: row.stateId },
      select: {
        name: true,
        workflowType: true,
        color: { select: { value: true } },
      },
    });
    stateName = state?.name ?? null;
    stateColor = state?.color?.value ?? null;
    stateIsCompleted = state?.workflowType === "DONE";
  }
  await webhookEvents.emit(
    "test_run.created",
    {
      runId: row.id,
      runTitle: row.name,
      projectId: row.projectId,
      stateId: row.stateId,
      stateName,
      stateColor,
      isCompleted: stateIsCompleted,
    },
    {
      projectId: opts.projectId ?? row.projectId,
      tx,
      actorUserId: opts.actorUserId,
    }
  );
  // Wake the runs-list consumer so a newly created run appears without a
  // manual refresh (the per-project channel feeds the list page).
  publishTestRunWakeUp({
    event: "test_run.created",
    runId: row.id,
    projectId: row.projectId,
  });
}

export async function emitTestRunUpdateEvents(
  oldRow: TestRunRow | null,
  newRow: TestRunRow,
  tx: TxClient,
  opts: EmitOptions = {}
): Promise<void> {
  if (!oldRow) return;

  // Two INDEPENDENT lifecycle transitions on TestRuns. Either, both, or
  // neither can fire on a given update:
  //   - state_changed: stateId changed
  //   - completed:     isCompleted flipped false → true
  // isCompleted is the canonical "this run is done" signal on TestRuns —
  // a project admin can mark a run completed without changing its state,
  // and conversely change state without marking completed (e.g. moving
  // between IN_PROGRESS workflows). The Workflows.workflowType is for
  // workflow categorization, not the source of truth for completion.
  const stateChanged = oldRow.stateId !== newRow.stateId;
  const completedTransition =
    oldRow.isCompleted !== true && newRow.isCompleted === true;
  if (!stateChanged && !completedTransition) return;

  if (stateChanged) {
    const [fromState, toState] = await Promise.all([
      oldRow.stateId != null
        ? tx.workflows.findUnique({
            where: { id: oldRow.stateId },
            select: {
              name: true,
              workflowType: true,
              color: { select: { value: true } },
            },
          })
        : Promise.resolve(null),
      newRow.stateId != null
        ? tx.workflows.findUnique({
            where: { id: newRow.stateId },
            select: {
              name: true,
              workflowType: true,
              color: { select: { value: true } },
            },
          })
        : Promise.resolve(null),
    ]);

    await webhookEvents.emit(
      "test_run.state_changed",
      {
        runId: newRow.id,
        runTitle: newRow.name,
        projectId: newRow.projectId,
        from: {
          stateId: oldRow.stateId,
          stateName: fromState?.name ?? null,
          stateColor: fromState?.color?.value ?? null,
          isCompleted: oldRow.isCompleted === true,
        },
        to: {
          stateId: newRow.stateId,
          stateName: toState?.name ?? null,
          stateColor: toState?.color?.value ?? null,
          isCompleted: newRow.isCompleted === true,
        },
        isCompletedTransition: completedTransition,
      },
      {
        projectId: opts.projectId ?? newRow.projectId,
        tx,
        actorUserId: opts.actorUserId,
      }
    );
    publishTestRunWakeUp({
      event: "test_run.state_changed",
      runId: newRow.id,
      projectId: newRow.projectId,
    });
  }

  if (completedTransition) {
    // Payload is the full TestRunSummaryData shape used by the in-app
    // summary UI, enriched with run identity + deep-link so Slack (and
    // any other consumer) can render a self-contained message without
    // an API round-trip.
    const summary = await getTestRunSummary(newRow.id, { client: tx });
    // Per-case iteration counts read from denormalized counters on
    // TestRunCases. Non-parameterized cases report iterationCount: 0
    // (no false positives). Single SELECT inside the same tx as
    // getTestRunSummary so the snapshot is consistent.
    const perCaseIterationCounts = await getPerCaseIterationCounts(
      newRow.id,
      tx
    );
    // For parameterized cases, append per-iteration redacted values so
    // subscribers can route on parameter context without an API
    // round-trip. `viewerCanReadSensitive` is hardcoded `false` — the
    // external webhook subscriber is never a viewer. Each value is
    // capped at 4 KB to bound payload size for 5000-iteration runs.
    const perCaseRedactedIterations = await assemblePerCaseRedactedIterations(
      newRow.id,
      tx
    );
    const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
    // Locale-less path; next-intl resolves the recipient's preferred locale at request time.
    const runUrl = `${baseUrl}/projects/runs/${newRow.projectId}/${newRow.id}`;
    await webhookEvents.emit(
      "test_run.completed",
      {
        ...(summary as unknown as Record<string, unknown>),
        perCaseIterationCounts,
        perCaseRedactedIterations,
        runId: newRow.id,
        runTitle: newRow.name,
        runUrl,
      },
      {
        projectId: opts.projectId ?? newRow.projectId,
        tx,
        actorUserId: opts.actorUserId,
      }
    );
    publishTestRunWakeUp({
      event: "test_run.completed",
      runId: newRow.id,
      projectId: newRow.projectId,
    });
  }
}

/**
 * Per-case redacted iteration values for the `test_run.completed` webhook
 * payload. For each parameterized run-case: read the snapshot for the
 * parameter schema, then pass each iteration's valuesJson through
 * `redactValues(values, schema, false)` and cap each value at 4 KB.
 * Non-parameterized cases (no snapshot) are omitted — the subscriber can
 * correlate by `testRunCaseId` against `perCaseIterationCounts`.
 */
async function assemblePerCaseRedactedIterations(
  testRunId: number,
  tx: TxClient
): Promise<
  Array<{
    testRunCaseId: number;
    iterations: Array<{
      iterationId: number;
      rowIndex: number;
      redactedValues: Record<string, unknown>;
    }>;
  }>
> {
  const snapshots = await tx.testRunCaseDataSetSnapshot.findMany({
    where: {
      testRunCase: { testRunId },
      isDeleted: false,
    },
    select: {
      testRunCaseId: true,
      parametersJson: true,
      iterations: {
        where: { isDeleted: false },
        orderBy: { rowIndex: "asc" },
        select: { id: true, rowIndex: true, valuesJson: true },
      },
    },
  });
  return snapshots.map((snap) => {
    const schema = parseParameterSchema(snap.parametersJson);
    return {
      testRunCaseId: snap.testRunCaseId,
      iterations: snap.iterations.map((iter) => {
        const values = (iter.valuesJson ?? {}) as Record<string, unknown>;
        // Order matters: redact first (so the [REDACTED] sentinel is
        // never accidentally byte-capped), then cap.
        const redacted = redactValues(values, schema, false);
        return {
          iterationId: iter.id,
          rowIndex: iter.rowIndex,
          redactedValues: capValueBytes(redacted),
        };
      }),
    };
  });
}

/** Shape a TestRunResults row read from the $extends hook. */
export interface TestRunResultRow {
  id: number;
  testRunId: number;
  testRunCaseId: number;
  statusId?: number | null;
  attempt?: number | null;
  executedById?: string | null;
  executedAt?: Date | null;
}

export async function emitTestRunResultAdded(
  row: TestRunResultRow,
  tx: TxClient,
  opts: EmitOptions = {}
): Promise<void> {
  // Fetch the producing testRun + status + linked repository case (via
  // testRunCases) to enrich the payload. Status is required on
  // TestRunResults so we can always look it up.
  const [run, status, testRunCase] = await Promise.all([
    tx.testRuns.findUnique({
      where: { id: row.testRunId },
      select: { id: true, name: true, projectId: true },
    }),
    row.statusId != null
      ? tx.status.findUnique({
          where: { id: row.statusId },
          select: {
            id: true,
            name: true,
            isCompleted: true,
            isSuccess: true,
            isFailure: true,
            color: { select: { value: true } },
          },
        })
      : Promise.resolve(null),
    tx.testRunCases.findUnique({
      where: { id: row.testRunCaseId },
      select: {
        repositoryCase: { select: { id: true, name: true } },
      },
    }),
  ]);
  if (!run) return; // testRun deleted between insert and emit — skip.
  await webhookEvents.emit(
    "test_run.result_added",
    {
      runId: run.id,
      runTitle: run.name,
      projectId: run.projectId,
      caseId: testRunCase?.repositoryCase?.id ?? null,
      caseName: testRunCase?.repositoryCase?.name ?? null,
      resultId: row.id,
      statusId: status?.id ?? null,
      statusName: status?.name ?? null,
      statusColor: status?.color?.value ?? null,
      isCompleted: status?.isCompleted ?? false,
      isSuccess: status?.isSuccess ?? false,
      isFailure: status?.isFailure ?? false,
      executedById: row.executedById ?? null,
      executedAt: row.executedAt?.toISOString() ?? null,
      attempt: row.attempt ?? 1,
    },
    {
      projectId: opts.projectId ?? run.projectId,
      tx,
      actorUserId: opts.actorUserId,
    }
  );
  publishTestRunWakeUp({
    event: "test_run.result_added",
    runId: run.id,
    projectId: run.projectId,
    targetId: row.testRunCaseId,
  });
}

/**
 * Live-update nudge for an automation (JUnit) result.
 *
 * Unlike manual TestRunResults, JUnit results have no webhook event — this
 * only wakes SSE consumers so the test-run detail page (and the list-page
 * status) refresh as automation results stream in from a reporter. The
 * run + project are resolved through the result's suite -> run -> project
 * chain (a JUnit result carries no projectId of its own).
 */
export async function emitJUnitResultAdded(
  row: { id: number; testSuiteId: number },
  tx: TxClient
): Promise<void> {
  const suite = await tx.jUnitTestSuite.findUnique({
    where: { id: row.testSuiteId },
    select: { testRun: { select: { id: true, projectId: true } } },
  });
  const run = suite?.testRun;
  if (!run) return; // suite/run deleted between insert and emit — skip.
  publishTestRunWakeUp({
    event: "test_run.result_added",
    runId: run.id,
    projectId: run.projectId,
    targetId: row.id,
  });
}

export async function emitTestRunDuplicated(
  newRunId: number,
  sourceRunId: number,
  tx: TxClient,
  opts: EmitOptions & { projectId: number }
): Promise<void> {
  const newRun = await tx.testRuns.findUnique({
    where: { id: newRunId },
    select: { id: true, name: true, projectId: true },
  });
  if (!newRun) return;
  await webhookEvents.emit(
    "test_run.duplicated",
    {
      newRunId: newRun.id,
      sourceRunId,
      runTitle: newRun.name,
      projectId: newRun.projectId,
    },
    {
      projectId: opts.projectId,
      tx,
      actorUserId: opts.actorUserId,
    }
  );
}
