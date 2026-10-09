import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key} ${JSON.stringify(params)}` : key,
}));
vi.mock("~/lib/navigation", () => ({
  Link: ({ children, href, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/tables/CaseDisplay", () => ({
  CaseDisplay: ({ testCase }: any) => <span>{testCase.name}</span>,
}));
vi.mock("@/components/TestRunNameDisplay", () => ({
  TestRunNameDisplay: ({ testRun }: any) => <span>{testRun.name}</span>,
}));
vi.mock("@/components/MilestoneNameDisplay", () => ({
  MilestoneNameDisplay: ({ milestone }: any) => <span>{milestone.name}</span>,
}));
vi.mock("@/components/tables/ProjectNameCell", () => ({
  ProjectNameCell: ({ value }: any) => <span>{value}</span>,
}));

import { AlertTriggeredNotification } from "./AlertTriggeredNotification";

const data = {
  eventId: 101,
  ruleId: 4,
  ruleName: "Slow checkout",
  metric: "CONSECUTIVE_FAILURES",
  projectId: 7,
  projectName: "Shop",
  subjectType: "CASE" as const,
  subjectId: 9,
  subjectName: "Checkout",
  observedValue: 3,
  baselineValue: null,
  thresholdValue: 3,
  testRunId: 42,
  details: { streak: 3 },
};

describe("AlertTriggeredNotification", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("leads with the rule, renders the metric sentence and links to the case in its run", () => {
    render(<AlertTriggeredNotification data={data} />);

    expect(
      screen.getByTestId("notification-alert-triggered")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Slow checkout" })
    ).toBeInTheDocument();
    expect(screen.queryByText("alertTriggeredTitle")).not.toBeInTheDocument();
    expect(screen.getByTestId("notification-alert-detail")).toHaveTextContent(
      'alertMetric.CONSECUTIVE_FAILURES {"streak":3,"threshold":3}'
    );
    expect(
      screen.getByTestId("notification-alert-subject-link")
    ).toHaveAttribute("href", "/projects/runs/7/42?selectedCase=9");
    expect(screen.getByText("inProject")).toBeInTheDocument();
    expect(screen.getByText("Shop")).toBeInTheDocument();
  });

  it("has no unsubscribe control; leaving the audience happens on the alerts page", () => {
    render(<AlertTriggeredNotification data={data} />);
    expect(
      screen.queryByTestId("notification-alert-unsubscribe")
    ).not.toBeInTheDocument();
  });

  it("renders run and milestone subjects with their own links", () => {
    const { rerender } = render(
      <AlertTriggeredNotification
        data={{
          ...data,
          subjectType: "RUN",
          subjectId: 42,
          subjectName: "Nightly",
        }}
      />
    );
    expect(screen.getByText("Nightly")).toBeInTheDocument();
    expect(
      screen.getByTestId("notification-alert-subject-link")
    ).toHaveAttribute("href", "/projects/runs/7/42");

    rerender(
      <AlertTriggeredNotification
        data={{
          ...data,
          subjectType: "MILESTONE",
          subjectId: 5,
          subjectName: "Release 1",
          testRunId: null,
        }}
      />
    );
    expect(screen.getByText("Release 1")).toBeInTheDocument();
    expect(
      screen.getByTestId("notification-alert-subject-link")
    ).toHaveAttribute("href", "/projects/milestones/7/5");
  });
});
