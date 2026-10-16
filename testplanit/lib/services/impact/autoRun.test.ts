import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRunFromAnalysis } from "./autoRun";

function makeDb(analysis: unknown, workflow: unknown = { id: 5 }) {
  return {
    impactAnalysis: {
      findUnique: vi.fn().mockResolvedValue(analysis),
      update: vi.fn().mockResolvedValue({}),
    },
    impactAnalysisCase: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    workflows: { findFirst: vi.fn().mockResolvedValue(workflow) },
    testRuns: { create: vi.fn().mockResolvedValue({ id: 300 }) },
    webhookDelivery: { update: vi.fn().mockResolvedValue({}) },
  };
}
const autoRun = {
  trigger: "pull_request",
  label: "PR #12: Fix checkout",
  url: "https://github.com/acme/app/pull/12",
  deliveryId: "del-1",
};
const analysis = {
  id: 77,
  projectId: 3,
  testRunId: null,
  project: { createdBy: "owner-1" },
  cases: [{ caseId: 10 }, { caseId: 11 }, { caseId: 10 }],
};

describe("createRunFromAnalysis", () => {
  beforeEach(() => vi.clearAllMocks());

  it("composes a run of the affected cases, links it, and marks the acceptance", async () => {
    const db = makeDb(analysis);

    const result = await createRunFromAnalysis(db, 77, autoRun);

    expect(result).toEqual({ created: true, testRunId: 300, caseCount: 2 });
    expect(db.impactAnalysis.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          cases: expect.objectContaining({
            where: { suggested: true, tier: { in: ["pinned", "affected"] } },
          }),
        }),
      })
    );
    expect(db.testRuns.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: 3,
        name: "PR #12: Fix checkout",
        stateId: 5,
        createdById: "owner-1",
        testRunType: "REGULAR",
        testCases: {
          create: [
            { repositoryCase: { connect: { id: 10 } }, order: 0 },
            { repositoryCase: { connect: { id: 11 } }, order: 1 },
          ],
        },
      }),
      select: { id: true },
    });
    const note = db.testRuns.create.mock.calls[0][0].data.note;
    expect(note).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "PR #12: Fix checkout — " },
            {
              type: "text",
              text: "https://github.com/acme/app/pull/12",
              marks: [
                {
                  type: "link",
                  attrs: { href: "https://github.com/acme/app/pull/12" },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(db.impactAnalysis.update).toHaveBeenCalledWith({
      where: { id: 77 },
      data: { testRunId: 300 },
    });
    expect(db.impactAnalysisCase.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { analysisId: 77, suggested: true, caseId: { in: [10, 11] } },
        data: expect.objectContaining({
          accepted: true,
          reviewedById: "owner-1",
        }),
      })
    );
    expect(db.webhookDelivery.update).toHaveBeenLastCalledWith({
      where: { id: "del-1" },
      data: { subjectRef: "run:300", error: null },
    });
  });

  it("writes one linked paragraph per event link, so a merge push names its pull request", async () => {
    const db = makeDb(analysis);
    await createRunFromAnalysis(db, 77, {
      trigger: "push",
      label: "main aaaaaaa…bbbbbbb (PR #12: Fix checkout)",
      url: "https://github.com/acme/app/pull/12",
      links: [
        {
          label: "main aaaaaaa…bbbbbbb",
          url: "https://github.com/acme/app/compare/a...b",
        },
        {
          label: "PR #12: Fix checkout",
          url: "https://github.com/acme/app/pull/12",
        },
      ],
    });
    const { name, note } = db.testRuns.create.mock.calls[0][0].data;
    expect(name).toBe("main aaaaaaa…bbbbbbb (PR #12: Fix checkout)");
    expect(note.content).toHaveLength(2);
    expect(note.content[0].content[1]).toEqual({
      type: "text",
      text: "https://github.com/acme/app/compare/a...b",
      marks: [
        {
          type: "link",
          attrs: { href: "https://github.com/acme/app/compare/a...b" },
        },
      ],
    });
    expect(note.content[1].content[0].text).toBe("PR #12: Fix checkout — ");
    expect(note.content[1].content[1].marks[0].attrs.href).toBe(
      "https://github.com/acme/app/pull/12"
    );
  });

  it("appends the build's pull requests and orphan commits to the note", async () => {
    const db = makeDb(analysis);
    await createRunFromAnalysis(
      db,
      77,
      {
        trigger: "push",
        label: "master d0db345…2828d02",
        url: "https://bitbucket.org/acme/app/branches/compare/2828d02..d0db345",
      },
      {
        pullRequests: [
          {
            number: 2957,
            title: "Fixes/ABT-48564 pip activity token crash",
            url: "https://bitbucket.org/acme/app/pull-requests/2957",
          },
          { number: 2960, title: "Sync worker", url: null },
        ],
        orphanCommits: [
          {
            shortSha: "e34a9ac",
            subject: "Add test coverage for Share With Public",
            url: "https://bitbucket.org/acme/app/commits/e34a9ac",
          },
        ],
        truncated: true,
        uncheckedCommits: 3,
      }
    );
    const note = db.testRuns.create.mock.calls[0][0].data.note;
    expect(note.content).toHaveLength(6);
    expect(note.content[0].content[0].text).toBe("master d0db345…2828d02 — ");
    expect(note.content[1]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "Pull requests in this build (2)" }],
    });
    expect(note.content[2]).toEqual({
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "PR #2957: Fixes/ABT-48564 pip activity token crash",
                  marks: [
                    {
                      type: "link",
                      attrs: {
                        href: "https://bitbucket.org/acme/app/pull-requests/2957",
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "PR #2960: Sync worker" }],
            },
          ],
        },
      ],
    });
    expect(note.content[3].content[0].text).toBe(
      "Commits not in a pull request (1)"
    );
    expect(note.content[4].content[0].content[0].content).toEqual([
      {
        type: "text",
        text: "e34a9ac",
        marks: [
          {
            type: "link",
            attrs: { href: "https://bitbucket.org/acme/app/commits/e34a9ac" },
          },
        ],
      },
      { type: "text", text: " Add test coverage for Share With Public" },
    ]);
    expect(note.content[5].content[0].text).toBe("…and 3 more commits");
  });

  it("writes exactly the link paragraphs when the build lookup found nothing", async () => {
    const db = makeDb(analysis);
    await createRunFromAnalysis(
      db,
      77,
      { trigger: "push", label: "main a…b" },
      {
        pullRequests: [],
        orphanCommits: [],
        truncated: false,
        uncheckedCommits: 0,
      }
    );
    expect(db.testRuns.create.mock.calls[0][0].data.note).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "main a…b" }] },
      ],
    });
  });

  it("writes the label alone when the event had no link", async () => {
    const db = makeDb(analysis);
    await createRunFromAnalysis(db, 77, { trigger: "push", label: "main a…b" });
    expect(db.testRuns.create.mock.calls[0][0].data.note).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "main a…b" }] },
      ],
    });
  });

  it("takes every suggested case at or above the webhook's minimum score instead of the tiers", async () => {
    const db = makeDb(analysis);

    const result = await createRunFromAnalysis(db, 77, {
      ...autoRun,
      minScore: 70,
    });

    expect(result).toEqual({ created: true, testRunId: 300, caseCount: 2 });
    expect(db.impactAnalysis.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          cases: expect.objectContaining({
            where: { suggested: true, score: { gte: 70 } },
          }),
        }),
      })
    );
  });

  it("keeps the pinned and affected tiers when the webhook leaves the minimum score empty", async () => {
    const db = makeDb(analysis);

    await createRunFromAnalysis(db, 77, { ...autoRun, minScore: null });

    expect(
      db.impactAnalysis.findUnique.mock.calls[0][0].select.cases.where
    ).toEqual({ suggested: true, tier: { in: ["pinned", "affected"] } });
  });

  it("makes no run when the analysis found no affected cases, and says so on the delivery", async () => {
    const db = makeDb({ ...analysis, cases: [] });

    const result = await createRunFromAnalysis(db, 77, autoRun);

    expect(result).toEqual({ created: false, reason: "no_cases" });
    expect(db.testRuns.create).not.toHaveBeenCalled();
    expect(db.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del-1" },
      data: { subjectRef: "analysis:77", error: "run:no_affected_cases" },
    });
  });

  it("does not compose a second run for an analysis already linked to one", async () => {
    const db = makeDb({ ...analysis, testRunId: 44 });

    expect(await createRunFromAnalysis(db, 77, autoRun)).toEqual({
      created: false,
      reason: "already_linked",
    });
    expect(db.testRuns.create).not.toHaveBeenCalled();
  });

  it("falls back to any enabled run workflow and gives up without one", async () => {
    const db = makeDb(analysis, null);
    db.workflows.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 8 });
    expect(await createRunFromAnalysis(db, 77, autoRun)).toMatchObject({
      created: true,
    });
    expect(db.testRuns.create.mock.calls[0][0].data.stateId).toBe(8);

    const none = makeDb(analysis, null);
    expect(await createRunFromAnalysis(none, 77, autoRun)).toEqual({
      created: false,
      reason: "no_workflow",
    });
  });

  it("truncates a long label into the run name", async () => {
    const db = makeDb(analysis);
    await createRunFromAnalysis(db, 77, { ...autoRun, label: "x".repeat(400) });
    expect(db.testRuns.create.mock.calls[0][0].data.name).toHaveLength(200);
  });
});
