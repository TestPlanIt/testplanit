import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: vi.fn(() => (key: string) => key),
  useLocale: vi.fn(() => "en-US"),
}));

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({
    data: { user: { id: "user-1", preferences: {} } },
    status: "authenticated",
    update: vi.fn(),
  })),
}));

// Read-only children that are irrelevant to the Risk Score gating.
vi.mock("~/components/comments/CommentsSection", () => ({
  CommentsSection: () => null,
}));
vi.mock("@/components/AttachmentsDisplay", () => ({
  AttachmentsDisplay: () => null,
}));
vi.mock("@/components/tables/AttachmentsListDisplay", () => ({
  AttachmentsListDisplay: () => null,
}));
vi.mock("@/components/AttachmentsCarousel", () => ({
  AttachmentsCarousel: () => null,
}));
vi.mock("@/components/tables/IssuesDisplay", () => ({
  IssuesDisplay: () => null,
}));
vi.mock("@/components/tables/TagDisplay", () => ({ TagsDisplay: () => null }));
vi.mock("@/components/issues/UnifiedIssueManager", () => ({
  UnifiedIssueManager: () => null,
}));
vi.mock("@/components/ManageTags", () => ({ ManageTags: () => null }));
vi.mock("@/components/UploadAttachments", () => ({ default: () => null }));

import TestCaseFormControls from "./TestCaseFormControl";

function renderPanel({
  riskScore,
  riskScoringEnabled,
}: {
  riskScore: number | null;
  riskScoringEnabled: boolean;
}) {
  return render(
    <TestCaseFormControls
      isEditMode={false}
      isSubmitting={false}
      testcase={{
        id: 1,
        automated: false,
        riskScore,
        riskReasons: null,
        caseTags: [],
        caseIssues: [],
        attachments: [],
      }}
      setSelectedFiles={vi.fn()}
      selectedFiles={[]}
      handleSelect={vi.fn()}
      selectedAttachmentIndex={null}
      selectedAttachments={[]}
      handleClose={vi.fn()}
      errors={{}}
      canAddEdit={false}
      riskScoringEnabled={riskScoringEnabled}
    />
  );
}

describe("TestCaseFormControls risk score", () => {
  it("shows the score when risk scoring is on and the case is scored", () => {
    renderPanel({ riskScore: 72, riskScoringEnabled: true });
    expect(screen.getByTestId("risk-score-badge")).toHaveTextContent("72");
  });

  it("omits the item entirely when the case has no score yet", () => {
    renderPanel({ riskScore: null, riskScoringEnabled: true });
    expect(screen.queryByTestId("risk-score-badge")).toBeNull();
    // Hidden, not rendered as a dash: the empty cell must not appear either.
    expect(screen.queryByTestId("risk-score-empty")).toBeNull();
  });

  it("omits the item when risk scoring is off for the project", () => {
    renderPanel({ riskScore: 72, riskScoringEnabled: false });
    expect(screen.queryByTestId("risk-score-badge")).toBeNull();
  });
});
