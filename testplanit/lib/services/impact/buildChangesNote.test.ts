import { describe, expect, it } from "vitest";
import { buildChangesNodes } from "./buildChangesNote";

describe("buildChangesNodes", () => {
  it("lists the pull requests, the orphan commits and the unchecked count", () => {
    const nodes = buildChangesNodes({
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
    });

    expect(nodes).toHaveLength(5);
    expect(nodes[0]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "Pull requests in this build (2)" }],
    });
    expect(nodes[1]).toEqual({
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
    expect(nodes[2].content?.[0]).toEqual({
      type: "text",
      text: "Commits not in a pull request (1)",
    });
    expect(nodes[3].content?.[0].content?.[0].content).toEqual([
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
    expect(nodes[4].content?.[0]).toEqual({
      type: "text",
      text: "…and 3 more commits",
    });
  });

  it("returns nothing when the lookup found nothing or did not run", () => {
    expect(buildChangesNodes(undefined)).toEqual([]);
    expect(buildChangesNodes(null)).toEqual([]);
    expect(
      buildChangesNodes({
        pullRequests: [],
        orphanCommits: [],
        truncated: false,
        uncheckedCommits: 0,
      })
    ).toEqual([]);
  });

  it("skips the unchecked line when nothing was left unchecked", () => {
    const nodes = buildChangesNodes({
      pullRequests: [{ number: 1, title: "One", url: null }],
      orphanCommits: [],
      truncated: false,
      uncheckedCommits: 0,
    });
    expect(nodes).toHaveLength(2);
  });
});
