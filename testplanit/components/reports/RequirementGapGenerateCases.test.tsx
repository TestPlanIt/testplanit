// The gap report's "Generate Test Cases" host: re-reads the clicked gap
// row's requirement and mounts the generation wizard with a full seed.
//
// The where-argument assertion here is the PRIMARY guard for this file's
// entry in lib/services/issueRoleScope.containment.test.ts's SCOPED_FILES
// allowlist (the LinkedRequirementsPanel.test.tsx convention): it asserts
// on the mocked hook's own `where` argument, importing the real
// REQUIREMENT_SCOPE_WHERE constant so a predicate rename can't drift past
// it. The seed-shaping tests run the real lock-aware resolvers
// (utils/issueDisplayText.ts) and the real TipTap flattening — only the
// query hook and the (large, dynamically imported) wizard are stubbed.

import { render } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REQUIREMENT_SCOPE_WHERE } from "~/lib/services/issueRoleScope";

const findFirstSpy = vi.hoisted(() => vi.fn());
const wizardRenders = vi.hoisted(() => ({ calls: [] as any[] }));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({ issue: { useFindFirst: findFirstSpy } }),
}));

// Keep the generated schema out of the test graph — the mocked
// useClientQueries never reads it.
vi.mock("~/zenstack/schema", () => ({ schema: {} }));

// next/dynamic would kick off the real (6k-line) wizard module load; a
// props-recording stub keeps the seed contract observable without it.
vi.mock("next/dynamic", () => ({
  default: () =>
    function WizardStub(props: any) {
      wizardRenders.calls.push(props);
      return <div data-testid="generate-wizard-stub" />;
    },
}));

import { RequirementGapGenerateCases } from "./RequirementGapGenerateCases";

const baseProps = {
  projectId: 370,
  requirementId: 42,
  requirementKey: "REQ-42",
  requirementTitle: "Enrol domestic students",
  onClose: vi.fn(),
};

function lastSeed() {
  const call = wizardRenders.calls.at(-1);
  if (!call) throw new Error("wizard was never rendered");
  return call.seedIssue;
}

describe("RequirementGapGenerateCases", () => {
  beforeEach(() => {
    findFirstSpy.mockReset();
    wizardRenders.calls.length = 0;
  });

  it("reads the requirement with the role predicate, the project pin, and the soft-delete guard", () => {
    findFirstSpy.mockReturnValue({ data: undefined, isLoading: true });
    render(<RequirementGapGenerateCases {...baseProps} />);

    expect(findFirstSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 42,
          projectId: 370,
          ...REQUIREMENT_SCOPE_WHERE,
          isDeleted: false,
        }),
      })
    );
    // Still loading — the wizard must not open on a half-built seed.
    expect(wizardRenders.calls).toHaveLength(0);
  });

  it("seeds a synced (locked) requirement from the tracker-owned columns", () => {
    findFirstSpy.mockReturnValue({
      isLoading: false,
      data: {
        id: 42,
        name: "ABT-42",
        title: "Enrol domestic students",
        description: "Tracker body text",
        note: null,
        status: "open",
        externalStatus: "In Progress",
        priority: "low",
        externalPriority: "High",
        externalId: "1001",
        externalUrl: "https://tracker.example/ABT-42",
        externalKey: "ABT-42",
        integrationId: 9,
        isRequirement: true,
        requirementDetachedAt: null,
      },
    });
    render(<RequirementGapGenerateCases {...baseProps} />);

    expect(lastSeed()).toEqual({
      issueId: 42,
      key: "ABT-42",
      title: "Enrol domestic students",
      description: "Tracker body text",
      // Locked row: the lock-aware resolvers pick the tracker mirrors
      // (externalStatus/externalPriority), never the local columns.
      status: "In Progress",
      priority: "High",
      externalId: "1001",
      externalUrl: "https://tracker.example/ABT-42",
      integrationId: 9,
    });
  });

  it("seeds a native requirement's body from its rich-text note when description is empty", () => {
    findFirstSpy.mockReturnValue({
      isLoading: false,
      data: {
        id: 43,
        name: "Enrol overseas students",
        title: "Enrol overseas students",
        description: "",
        note: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Native requirement body" }],
            },
          ],
        },
        status: "open",
        externalStatus: null,
        priority: "medium",
        externalPriority: null,
        externalId: null,
        externalUrl: null,
        externalKey: null,
        integrationId: null,
        isRequirement: true,
        requirementDetachedAt: null,
      },
    });
    render(<RequirementGapGenerateCases {...baseProps} requirementId={43} />);

    const seed = lastSeed();
    expect(seed.key).toBe("Enrol overseas students");
    expect(seed.description).toBe("Native requirement body");
    expect(seed.status).toBe("open");
    expect(seed.priority).toBe("medium");
    expect(seed.integrationId).toBeNull();
  });

  it("falls back to the row's own display fields when the read settles empty", () => {
    // Requirement deleted or declassified since the report ran — the
    // action still opens instead of dead-ending silently.
    findFirstSpy.mockReturnValue({ data: null, isLoading: false });
    render(<RequirementGapGenerateCases {...baseProps} />);

    expect(lastSeed()).toEqual({
      issueId: 42,
      key: "REQ-42",
      title: "Enrol domestic students",
    });
  });

  it("closes through onClose when the wizard dismisses", () => {
    const onClose = vi.fn();
    findFirstSpy.mockReturnValue({ data: null, isLoading: false });
    render(<RequirementGapGenerateCases {...baseProps} onClose={onClose} />);

    const props = wizardRenders.calls.at(-1);
    props.onOpenChange(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    // Opening (true) must NOT close — only an explicit dismiss does.
    props.onOpenChange(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
