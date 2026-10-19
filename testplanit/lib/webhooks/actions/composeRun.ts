import type { JsonObject } from "@zenstackhq/orm";
import { emptyEditorContent } from "~/app/constants/backend";
import { buildGucPayload, withAuditGuc } from "~/lib/audit/gucContext";
import { filterEligibleCaseIds } from "~/lib/services/runCaseEligibility";
import { applyCaseFilter } from "./caseFilter";
import { emitTestRunCreated } from "~/lib/webhooks/event-emitters/testRunEvents";
import { updateTestRunForecast } from "~/services/forecastService";
import { syncTestRunToElasticsearch } from "~/services/testRunSearch";

const RUN_NAME_MAX = 200;

export interface RunNoteLink {
  label: string;
  url: string | null;
}

/** A TipTap document node, as the run note editor stores them. */
export type NoteNode = {
  type: string;
  content?: NoteNode[];
  [key: string]: unknown;
};

export interface ComposeRunInput {
  projectId: number;
  name: string;
  /** In the order the run should list them. */
  caseIds: number[];
  /** The rule's test case filters; only the cases matching every one go in. */
  caseFilter?: unknown;
  /** One note paragraph each, so the run shows where it came from. */
  links: RunNoteLink[];
  /** Nodes appended to the note after the link paragraphs. */
  noteAppendix?: NoteNode[];
  /** Issues the run is linked to. */
  issueIds?: number[];
  createdById: string;
  tenantId?: string;
}

export type ComposeRunResult =
  | { created: true; testRunId: number; caseCount: number; caseIds: number[] }
  | { created: false; reason: "no_cases" | "no_workflow" };

/**
 * The run's note: one paragraph per link, its label linked to the URL, then
 * whatever the caller appends.
 */
export function runNote(links: RunNoteLink[], appendix: NoteNode[] = []) {
  return {
    type: "doc",
    content: [
      ...links.map(({ label, url }) => ({
        type: "paragraph",
        content: [
          {
            type: "text",
            text: label,
            ...(url ? { marks: [{ type: "link", attrs: { href: url } }] } : {}),
          },
        ],
      })),
      ...appendix,
    ],
  };
}

/**
 * Create the test run a webhook action asked for from a list of cases: only
 * the project's live cases the run may take (drafts stay out when the
 * project says so) that match the rule's test case filters, under the
 * default run workflow state, linked to the given issues. Runs on the
 * worker's plain client, so the created event, forecast and search index the
 * app's own writes trigger are done here.
 */
export async function composeRunFromCases(
  db: any,
  input: ComposeRunInput
): Promise<ComposeRunResult> {
  const requested = [...new Set(input.caseIds)];
  if (requested.length === 0) return { created: false, reason: "no_cases" };

  const live = new Set<number>(
    (
      await db.repositoryCases.findMany({
        where: {
          id: { in: requested },
          projectId: input.projectId,
          isDeleted: false,
          isArchived: false,
        },
        select: { id: true },
      })
    ).map((c: { id: number }) => c.id)
  );
  const eligible = await filterEligibleCaseIds(db, {
    projectId: input.projectId,
    repositoryCaseIds: requested.filter((id) => live.has(id)),
  });
  const caseIds =
    Array.isArray(input.caseFilter) && input.caseFilter.length > 0
      ? await applyCaseFilter(db, input.projectId, eligible, input.caseFilter)
      : eligible;
  if (caseIds.length === 0) return { created: false, reason: "no_cases" };

  const workflow =
    (await db.workflows.findFirst({
      where: {
        scope: "RUNS",
        isDefault: true,
        isEnabled: true,
        isDeleted: false,
        projects: { some: { projectId: input.projectId } },
      },
      select: { id: true },
    })) ??
    (await db.workflows.findFirst({
      where: {
        scope: "RUNS",
        isEnabled: true,
        isDeleted: false,
        projects: { some: { projectId: input.projectId } },
      },
      orderBy: { order: "asc" },
      select: { id: true },
    }));
  if (!workflow) return { created: false, reason: "no_workflow" };

  const run = await withAuditGuc(
    db,
    {
      ...buildGucPayload(input.createdById),
      source: "worker",
      tenantId: input.tenantId ?? null,
    },
    async (tx) => {
      const row = await tx.testRuns.create({
        data: {
          projectId: input.projectId,
          name: input.name.slice(0, RUN_NAME_MAX),
          stateId: workflow.id,
          createdById: input.createdById,
          note: runNote(input.links, input.noteAppendix) as JsonObject,
          docs: emptyEditorContent,
          testRunType: "REGULAR",
          testCases: {
            create: caseIds.map((caseId, index) => ({
              repositoryCase: { connect: { id: caseId } },
              order: index,
            })),
          },
          ...(input.issueIds && input.issueIds.length > 0
            ? { issues: { connect: input.issueIds.map((id) => ({ id })) } }
            : {}),
        },
      });
      await emitTestRunCreated(row, tx, {
        actorUserId: input.createdById,
      });
      return row;
    }
  );

  await updateTestRunForecast(run.id, { dbClient: db }).catch((error) =>
    console.error(`[webhook-actions] forecast for run ${run.id} failed`, error)
  );
  void syncTestRunToElasticsearch(run.id, input.tenantId).catch((error) =>
    console.error(
      `[webhook-actions] search sync for run ${run.id} failed`,
      error
    )
  );

  return {
    created: true,
    testRunId: run.id,
    caseCount: caseIds.length,
    caseIds,
  };
}
