import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations:
    (namespace?: string) => (key: string, values?: Record<string, unknown>) =>
      `${namespace ? `${namespace}.` : ""}${key}${values ? JSON.stringify(values) : ""}`,
}));
vi.mock("~/lib/navigation", () => ({
  Link: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/admin/projects/CreateProjectWizard", () => ({
  CreateProjectWizard: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="create-project-wizard" /> : null,
}));

import type { SetupChecklistItem } from "~/hooks/useSetupChecklist";
import { SetupChecklistCard } from "./SetupChecklistCard";

const item = (
  key: SetupChecklistItem["key"],
  state: "todo" | "detected" | "marked",
  href: string | null
): SetupChecklistItem => ({
  key,
  detected: state === "detected",
  marked: state === "marked",
  done: state !== "todo",
  href,
});

const items: SetupChecklistItem[] = [
  item("createProject", "todo", null),
  item("inviteTeam", "detected", "/admin/users"),
  item("connectIssueTracker", "todo", "/admin/integrations"),
  item("connectAiProvider", "marked", "/admin/llm"),
  item("setUpSso", "todo", "/admin/sso"),
];

function renderCard(
  overrides: Partial<Parameters<typeof SetupChecklistCard>[0]> = {}
) {
  const onDismiss = vi.fn();
  const onMarkedChange = vi.fn();
  render(
    <SetupChecklistCard
      items={items}
      doneCount={2}
      onDismiss={onDismiss}
      onMarkedChange={onMarkedChange}
      showDemoNote={false}
      {...overrides}
    />
  );
  return { onDismiss, onMarkedChange };
}

describe("SetupChecklistCard", () => {
  it("shows progress and a ticked box for each done item", () => {
    renderCard();
    expect(
      screen.getByText('home.setupChecklist.progress{"done":2,"total":5}')
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", {
        name: "home.setupChecklist.items.inviteTeam",
      })
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", {
        name: "home.setupChecklist.items.connectAiProvider",
      })
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", {
        name: "home.setupChecklist.items.setUpSso",
      })
    ).not.toBeChecked();
  });

  it("locks items the app detected and lets admins tick the rest", () => {
    const { onMarkedChange } = renderCard();
    expect(
      screen.getByTestId("setup-checklist-checkbox-inviteTeam")
    ).toBeDisabled();

    fireEvent.click(screen.getByTestId("setup-checklist-checkbox-setUpSso"));
    expect(onMarkedChange).toHaveBeenCalledWith("setUpSso", true);

    // Clicking the label ticks too.
    fireEvent.click(
      screen.getByText("home.setupChecklist.items.createProject")
    );
    expect(onMarkedChange).toHaveBeenCalledWith("createProject", true);

    fireEvent.click(
      screen.getByTestId("setup-checklist-checkbox-connectAiProvider")
    );
    expect(onMarkedChange).toHaveBeenCalledWith("connectAiProvider", false);
  });

  it("offers a way to finish only the items that are not done", () => {
    renderCard();
    expect(screen.queryByTestId("setup-checklist-open-inviteTeam")).toBeNull();
    expect(
      screen.queryByTestId("setup-checklist-open-connectAiProvider")
    ).toBeNull();
    expect(screen.getByTestId("setup-checklist-open-setUpSso")).toHaveAttribute(
      "href",
      "/admin/sso"
    );
  });

  it("opens the project wizard for the create-project item", () => {
    renderCard();
    expect(screen.queryByTestId("create-project-wizard")).toBeNull();
    fireEvent.click(screen.getByTestId("setup-checklist-open-createProject"));
    expect(screen.getByTestId("create-project-wizard")).toBeInTheDocument();
  });

  it("hides the checklist only after the admin confirms", () => {
    const { onDismiss } = renderCard();
    fireEvent.click(screen.getByTestId("setup-checklist-hide"));
    expect(
      screen.getByText("home.setupChecklist.hideConfirm.description")
    ).toBeInTheDocument();
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("setup-checklist-hide-confirm"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("keeps the checklist when the admin cancels", () => {
    const { onDismiss } = renderCard();
    fireEvent.click(screen.getByTestId("setup-checklist-hide"));
    fireEvent.click(screen.getByText("common.cancel"));
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.queryByTestId("setup-checklist-hide-dialog")).toBeNull();
  });

  it("mentions the Demo Project only when there is one", () => {
    renderCard();
    expect(screen.queryByText("home.setupChecklist.demoNote")).toBeNull();
    renderCard({ showDemoNote: true });
    expect(
      screen.getByText("home.setupChecklist.demoNote")
    ).toBeInTheDocument();
  });
});
