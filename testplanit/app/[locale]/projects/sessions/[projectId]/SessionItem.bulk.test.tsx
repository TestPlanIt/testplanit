import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import SessionItem from "./SessionItem";

// SessionItem imports its testSession type from SessionDisplay; stub the
// module so the test doesn't load the whole display tree.
vi.mock("./SessionDisplay", () => ({}));

vi.mock("~/hooks/useProjectPermissions", () => ({
  useProjectPermissions: () => ({
    permissions: { canAddEdit: false, canClose: false, canDelete: false },
    isLoading: false,
  }),
}));
vi.mock("next-intl", () => ({
  useTranslations: vi.fn(() => (key: string) => key),
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ projectId: "1" }) }));
vi.mock("~/lib/navigation", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/components/DynamicIcon", () => ({ default: () => null }));
vi.mock("~/components/SessionResultsSummary", () => ({
  SessionResultsSummary: () => null,
}));
vi.mock("@/components/MemberList", () => ({ MemberList: () => null }));
vi.mock("@/components/WorkflowStateDisplay", () => ({
  WorkflowStateDisplay: () => null,
}));
vi.mock("@/components/TextFromJson", () => ({ default: () => null }));
vi.mock("@/components/DateTextDisplay", () => ({
  DateTextDisplay: () => null,
}));
vi.mock("@/components/MilestoneIconAndName", () => ({
  MilestoneIconAndName: () => null,
}));
vi.mock("@/components/RecordKeyMenuItem", () => ({
  RecordKeyMenuItem: () => null,
}));

const testSession = {
  id: 9,
  name: "Exploratory pass",
  isCompleted: false,
  configuration: null,
  configurationGroupId: null,
  state: { id: 1, name: "Active" },
  projectId: 1,
  createdBy: { id: "u1", name: "User One" },
  assignedTo: null,
  note: null,
} as any;

const renderItem = (props: Record<string, unknown> = {}) =>
  render(
    <TooltipProvider>
      <SessionItem
        testSession={testSession}
        isCompleted={false}
        onComplete={vi.fn()}
        canComplete={false}
        canDuplicate={false}
        canEdit={false}
        {...props}
      />
    </TooltipProvider>
  );

describe("SessionItem selection checkbox", () => {
  it("renders no checkbox when the row is not selectable", () => {
    renderItem();
    expect(screen.queryByTestId("session-select-9")).not.toBeInTheDocument();
  });

  it("renders the checkbox when selectable and reports selection changes", () => {
    const onSelectedChange = vi.fn();
    renderItem({ selectable: true, selected: false, onSelectedChange });
    const checkbox = screen.getByTestId("session-select-9");
    fireEvent.click(checkbox);
    expect(onSelectedChange).toHaveBeenCalledWith(true);
  });
});
