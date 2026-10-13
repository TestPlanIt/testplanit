import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { IssueReason } from "~/lib/services/impact/types";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <div>{children}</div>,
  TooltipTrigger: ({ children }: any) => <div>{children}</div>,
  TooltipContent: ({ children }: any) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
}));

import {
  groupReasonsByKind,
  ReasonBadges,
  reasonDetailLines,
} from "./ReasonBadges";

const issue: IssueReason = {
  kind: "ISSUE",
  issueId: 3,
  issueKey: "PROJ-9",
  commits: [
    { sha: "a".repeat(40), shortSha: "aaaaaaa" },
    { sha: "b".repeat(40), shortSha: "bbbbbbb" },
  ],
  files: ["src/a.ts"],
};

describe("ReasonBadges", () => {
  it("renders a Ticket badge for an ISSUE reason", () => {
    render(<ReasonBadges reasons={[issue]} />);
    const badge = screen.getByTestId("impact-reason-badge-ISSUE");
    expect(badge).toHaveTextContent("runs.impact.reasons.issue");
    expect(screen.getByTestId("tooltip-content")).toHaveTextContent(
      "runs.impact.reasons.issueDetail"
    );
  });

  it("orders ISSUE right after PIN and describes the ticket with its commit count", () => {
    const groups = groupReasonsByKind([
      { kind: "AI", rationale: "r", score: 50, batchIndex: 0 },
      issue,
      {
        kind: "PIN",
        pinId: 1,
        filePath: "src/a.ts",
        pinKind: "FILE",
        source: "MANUAL",
        confidence: "file",
      },
    ]);
    expect([...groups.keys()]).toEqual(["PIN", "ISSUE", "AI"]);

    const t = vi.fn((key: string) => key);
    expect(reasonDetailLines(t, "ISSUE", [issue])).toEqual([
      { text: "reasons.issueDetail" },
    ]);
    expect(t).toHaveBeenCalledWith("reasons.issueDetail", {
      key: "PROJ-9",
      count: 2,
      sha: "aaaaaaa",
    });
  });
});
