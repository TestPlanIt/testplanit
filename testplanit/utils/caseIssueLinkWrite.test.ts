import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  mergeRequirementLinksIntoVersionIssues,
  pickerOwnedIssueIds,
  planCaseIssueLinkWrite,
} from "./caseIssueLinkWrite";

// One case's links, spanning every combination of the two properties that
// tempt a caller to split "the picker owns this" into two different rules:
// whether an integration is behind the row, and whether the row is a
// requirement.
const NATIVE_REQUIREMENT = { id: 501, integrationId: null };
const SYNCED_REQUIREMENT = { id: 502, integrationId: 20 };
const TRACKER_DEFECT = { id: 700, integrationId: 20 };
const INTEGRATIONLESS_DEFECT = { id: 900, integrationId: null };

const allLinks = [
  { issue: NATIVE_REQUIREMENT },
  { issue: SYNCED_REQUIREMENT },
  { issue: TRACKER_DEFECT },
  { issue: INTEGRATIONLESS_DEFECT },
];

describe("pickerOwnedIssueIds", () => {
  it("seeds the form value with the links an integration is behind", () => {
    expect(pickerOwnedIssueIds(allLinks)).toEqual([
      SYNCED_REQUIREMENT.id,
      TRACKER_DEFECT.id,
    ]);
  });

  it("keeps a requirement the picker can round-trip because a tracker owns it", () => {
    // Filtering the seed by row kind instead of provenance would drop this id,
    // and the save — which preserves by provenance — would then delete a link
    // nobody touched.
    expect(pickerOwnedIssueIds([{ issue: SYNCED_REQUIREMENT }])).toEqual([
      SYNCED_REQUIREMENT.id,
    ]);
  });

  it("tolerates the shapes the case query can hand it", () => {
    expect(pickerOwnedIssueIds(undefined)).toEqual([]);
    expect(pickerOwnedIssueIds(null)).toEqual([]);
    expect(pickerOwnedIssueIds([{ issue: null }, {}])).toEqual([]);
  });
});

describe("the seed and the save read the same links", () => {
  it("partitions every link into exactly one of carried or held back", () => {
    const carried = pickerOwnedIssueIds(allLinks);
    const { preservedIssueIds } = planCaseIssueLinkWrite(allLinks, carried);

    const everyId = allLinks.map((link) => link.issue.id).sort((a, b) => a - b);
    expect([...carried, ...preservedIssueIds].sort((a, b) => a - b)).toEqual(
      everyId
    );
    expect(carried.filter((id) => preservedIssueIds.includes(id))).toEqual([]);
  });

  it("replaces exactly the links it carried and leaves the rest standing", () => {
    const carried = pickerOwnedIssueIds(allLinks);
    const { preservedIssueIds, linkedIssueIds } = planCaseIssueLinkWrite(
      allLinks,
      carried
    );

    // deleteMany({ caseId, issueId: { notIn: preservedIssueIds } }) then
    // createMany(linkedIssueIds) — the case's links must come out unchanged.
    const survivors = new Set(
      allLinks
        .map((link) => link.issue.id)
        .filter((id) => preservedIssueIds.includes(id))
    );
    for (const id of linkedIssueIds) survivors.add(id);

    expect([...survivors].sort((a, b) => a - b)).toEqual([
      NATIVE_REQUIREMENT.id,
      SYNCED_REQUIREMENT.id,
      TRACKER_DEFECT.id,
      INTEGRATIONLESS_DEFECT.id,
    ]);
  });
});

// The behavioral tests above and in caseIssueLinkSave.test.tsx drive these two
// rules directly, because the page that wires them together is far too large
// to render in this lane. Nothing in either file would notice the page
// dropping one half of the pair, so the wiring itself is asserted here —
// structurally, the way this repo's other unrenderable call sites are
// (lib/services/issueRoleScope.containment.test.ts).
describe("the case detail page wires both halves", () => {
  const PAGE =
    "app/[locale]/projects/repository/[projectId]/[caseId]/TestCaseDetailsView.tsx";

  it("seeds the Issues form value through pickerOwnedIssueIds", () => {
    const source = readFileSync(PAGE, "utf8");

    if (!source.includes("pickerOwnedIssueIds(testcase.caseIssues)")) {
      throw new Error(
        `${PAGE} no longer seeds its \`issues\` default value with ` +
          "pickerOwnedIssueIds(testcase.caseIssues). Seeding from every link " +
          "instead puts ids no picker owns into the form value; the simple-url " +
          "picker and the no-integration alert never publish over that seed, so " +
          "the save recreates a link the Linked Requirements panel just removed."
      );
    }
    expect(source).toContain("pickerOwnedIssueIds(testcase.caseIssues)");
  });

  it("plans the replace through planCaseIssueLinkWrite", () => {
    const source = readFileSync(PAGE, "utf8");

    if (!source.includes("planCaseIssueLinkWrite(")) {
      throw new Error(
        `${PAGE} no longer plans its issue-link replace through ` +
          "planCaseIssueLinkWrite. Deleting every link on the case and " +
          "recreating from the form value destroys the links the value does " +
          "not carry."
      );
    }
    expect(source).toContain("planCaseIssueLinkWrite(");
  });
});

// A version snapshot's issue list used to be the Issues form value verbatim,
// which is the tracker picker's set and nothing else -- so requirement links
// were recorded as absent even while they were linked, and a version diff
// showed one vanishing at a point in time when it was still there.
describe("mergeRequirementLinksIntoVersionIssues", () => {
  const pickerIssue = { id: 700, name: "BUG-1", externalId: "BUG-1" };

  it("adds a native requirement link the picker's value never carried", () => {
    const merged = mergeRequirementLinksIntoVersionIssues(
      [pickerIssue],
      [
        { issue: { id: 700, name: "BUG-1", externalId: "BUG-1" } },
        {
          issue: {
            id: 501,
            name: "Login must support SSO",
            externalId: null,
            isRequirement: true,
          },
        },
      ]
    );

    expect(merged).toEqual([
      pickerIssue,
      { id: 501, name: "Login must support SSO", externalId: null },
    ]);
  });

  it("leaves defect links that the picker did not submit out of the snapshot", () => {
    // A non-requirement link absent from the form value was removed by the
    // user; re-adding it here would resurrect it in history.
    const merged = mergeRequirementLinksIntoVersionIssues(
      [pickerIssue],
      [
        { issue: { id: 700, name: "BUG-1", externalId: "BUG-1" } },
        { issue: { id: 900, name: "BUG-9", externalId: "BUG-9" } },
      ]
    );

    expect(merged).toEqual([pickerIssue]);
  });

  it("does not duplicate a tracker-synced requirement the picker already holds", () => {
    // A synced requirement is integration-owned, so it legitimately appears
    // in both sets; the picker's copy is the one the user just edited.
    const merged = mergeRequirementLinksIntoVersionIssues(
      [{ id: 501, name: "REQ-1", externalId: "REQ-1" }],
      [
        {
          issue: {
            id: 501,
            name: "REQ-1 (stale name)",
            externalId: "REQ-1",
            isRequirement: true,
          },
        },
      ]
    );

    expect(merged).toEqual([{ id: 501, name: "REQ-1", externalId: "REQ-1" }]);
  });

  it("survives a case with no links at all", () => {
    expect(mergeRequirementLinksIntoVersionIssues([], null)).toEqual([]);
    expect(mergeRequirementLinksIntoVersionIssues([], undefined)).toEqual([]);
    expect(
      mergeRequirementLinksIntoVersionIssues([], [{ issue: null }])
    ).toEqual([]);
  });
});
