import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CaseAttentionBadge } from "./CaseAttentionBadge";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("CaseAttentionBadge", () => {
  it("renders nothing when the case is waiting on nobody", () => {
    const { container } = render(<CaseAttentionBadge kind={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ["UPDATE", "updateTitle"],
    ["RETIRE", "retireTitle"],
    ["DRAFT", "unreviewedDraft"],
  ] as const)("names AI work of kind %s", (kind, label) => {
    render(<CaseAttentionBadge kind={kind} />);
    expect(screen.getByTestId("ai-attention-badge")).toHaveAttribute(
      "aria-label",
      label
    );
    expect(screen.queryByTestId("issue-changed-badge")).toBeNull();
  });

  it("marks a changed issue with its own badge", () => {
    render(<CaseAttentionBadge kind="BEHIND" />);
    expect(screen.getByTestId("issue-changed-badge")).toHaveAttribute(
      "aria-label",
      "issueChangedList"
    );
    expect(screen.queryByTestId("ai-attention-badge")).toBeNull();
  });
});
