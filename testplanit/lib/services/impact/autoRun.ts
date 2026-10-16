import { emptyEditorContent } from "~/app/constants/backend";
import type { BuildChanges, ImpactAutoRun } from "./types";

/** Raw client surface for composing a run from a completed analysis. */
export interface AutoRunDb {
  impactAnalysis: {
    findUnique: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
  };
  impactAnalysisCase: { updateMany: (args: any) => Promise<any> };
  workflows: { findFirst: (args: any) => Promise<any> };
  testRuns: { create: (args: any) => Promise<any> };
  webhookDelivery: { update: (args: any) => Promise<any> };
}

export type AutoRunResult =
  | { created: true; testRunId: number; caseCount: number }
  | {
      created: false;
      reason:
        "already_linked" | "no_cases" | "no_workflow" | "analysis_missing";
    };

const RUN_NAME_MAX = 200;

type NoteNode = { type: string; content?: NoteNode[]; [key: string]: unknown };

function paragraph(content: NoteNode[]): NoteNode {
  return { type: "paragraph", content };
}

function text(value: string, href?: string | null): NoteNode {
  return href
    ? { type: "text", text: value, marks: [{ type: "link", attrs: { href } }] }
    : { type: "text", text: value };
}

function bulletList(items: NoteNode[][]): NoteNode {
  return {
    type: "bulletList",
    content: items.map((content) => ({
      type: "listItem",
      content: [paragraph(content)],
    })),
  };
}

/**
 * What a push's build was made of, for the reader: the pull requests, each
 * title linking to the pull request, then the commits no pull request
 * contains. Nothing when the lookup found nothing or did not run.
 */
function buildChangesNodes(
  changes: BuildChanges | null | undefined
): NoteNode[] {
  if (!changes) return [];
  const nodes: NoteNode[] = [];
  if (changes.pullRequests.length > 0) {
    nodes.push(
      paragraph([
        text(`Pull requests in this build (${changes.pullRequests.length})`),
      ]),
      bulletList(
        changes.pullRequests.map((pr) => [
          text(`PR #${pr.number}: ${pr.title}`, pr.url),
        ])
      )
    );
  }
  if (changes.orphanCommits.length > 0) {
    nodes.push(
      paragraph([
        text(`Commits not in a pull request (${changes.orphanCommits.length})`),
      ]),
      bulletList(
        changes.orphanCommits.map((c) => [
          text(c.shortSha, c.url),
          text(` ${c.subject}`),
        ])
      )
    );
  }
  if (changes.truncated && changes.uncheckedCommits > 0) {
    nodes.push(
      paragraph([text(`…and ${changes.uncheckedCommits} more commits`)])
    );
  }
  return nodes;
}

/**
 * The run's note: one paragraph per link the event left, the label as text
 * and the URL as a link mark, so the run shows where it came from and the
 * reader can get there; then, for a push whose pull requests were looked
 * up, what the build was made of.
 */
function runNote(autoRun: ImpactAutoRun, buildChanges?: BuildChanges | null) {
  const links =
    autoRun.links && autoRun.links.length > 0
      ? autoRun.links
      : [{ label: autoRun.label, url: autoRun.url ?? null }];
  return {
    type: "doc",
    content: [
      ...links.map(({ label, url }) =>
        paragraph(url ? [text(`${label} — `), text(url, url)] : [text(label)])
      ),
      ...buildChangesNodes(buildChanges),
    ],
  };
}

/** Which of the analysis's suggestions the run takes: the webhook's minimum score, else the pinned and affected tiers. */
function suggestionFilter(autoRun: ImpactAutoRun) {
  const minScore = autoRun.minScore;
  if (typeof minScore === "number" && Number.isFinite(minScore)) {
    return { suggested: true, score: { gte: minScore } };
  }
  return { suggested: true, tier: { in: ["pinned", "affected"] } };
}

/**
 * Compose the test run a repository webhook asked for: every case the
 * completed analysis put in the pinned or affected tier, or, when the
 * webhook sets a minimum score, every case scoring at least that, in score
 * order, under the project's default run workflow state, created by the
 * project's creator. The analysis is linked to the run and its suggestions
 * marked accepted, exactly as the dialog records a reviewer's acceptance.
 * With no affected cases no run is made; the delivery says so.
 */
export async function createRunFromAnalysis(
  db: AutoRunDb,
  analysisId: number,
  autoRun: ImpactAutoRun,
  buildChanges?: BuildChanges | null
): Promise<AutoRunResult> {
  const annotate = async (subjectRef: string | null, error: string | null) => {
    if (!autoRun.deliveryId) return;
    await db.webhookDelivery
      .update({
        where: { id: autoRun.deliveryId },
        data: { ...(subjectRef ? { subjectRef } : {}), error },
      })
      .catch(() => {});
  };

  const analysis = await db.impactAnalysis.findUnique({
    where: { id: analysisId },
    select: {
      id: true,
      projectId: true,
      testRunId: true,
      project: { select: { createdBy: true } },
      cases: {
        where: suggestionFilter(autoRun),
        orderBy: [{ score: "desc" }, { caseId: "asc" }],
        select: { caseId: true },
      },
    },
  });
  if (!analysis) {
    await annotate(null, "run:analysis_missing");
    return { created: false, reason: "analysis_missing" };
  }
  if (analysis.testRunId) {
    await annotate(`run:${analysis.testRunId}`, null);
    return { created: false, reason: "already_linked" };
  }
  const caseIds: number[] = [
    ...new Set<number>(analysis.cases.map((c: { caseId: number }) => c.caseId)),
  ];
  if (caseIds.length === 0) {
    await annotate(`analysis:${analysisId}`, "run:no_affected_cases");
    return { created: false, reason: "no_cases" };
  }

  const projectId: number = analysis.projectId;
  const workflow =
    (await db.workflows.findFirst({
      where: {
        scope: "RUNS",
        isDefault: true,
        isEnabled: true,
        isDeleted: false,
        projects: { some: { projectId } },
      },
      select: { id: true },
    })) ??
    (await db.workflows.findFirst({
      where: {
        scope: "RUNS",
        isEnabled: true,
        isDeleted: false,
        projects: { some: { projectId } },
      },
      orderBy: { order: "asc" },
      select: { id: true },
    }));
  if (!workflow) {
    await annotate(`analysis:${analysisId}`, "run:no_workflow");
    return { created: false, reason: "no_workflow" };
  }

  const run = await db.testRuns.create({
    data: {
      projectId,
      name: autoRun.label.slice(0, RUN_NAME_MAX),
      stateId: workflow.id,
      createdById: analysis.project.createdBy,
      note: runNote(autoRun, buildChanges),
      docs: emptyEditorContent,
      testRunType: "REGULAR",
      testCases: {
        create: caseIds.map((caseId, index) => ({
          repositoryCase: { connect: { id: caseId } },
          order: index,
        })),
      },
    },
    select: { id: true },
  });

  const reviewedAt = new Date();
  await db.impactAnalysis.update({
    where: { id: analysisId },
    data: { testRunId: run.id },
  });
  await db.impactAnalysisCase.updateMany({
    where: { analysisId, suggested: true, caseId: { in: caseIds } },
    data: {
      accepted: true,
      reviewedAt,
      reviewedById: analysis.project.createdBy,
    },
  });
  await db.impactAnalysisCase.updateMany({
    where: { analysisId, suggested: true, caseId: { notIn: caseIds } },
    data: {
      accepted: false,
      reviewedAt,
      reviewedById: analysis.project.createdBy,
    },
  });
  await annotate(`run:${run.id}`, null);
  return { created: true, testRunId: run.id, caseCount: caseIds.length };
}
