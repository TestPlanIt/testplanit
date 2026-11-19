import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("~/lib/navigation", () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { getAdminMenuSections } from "@/components/AdminMenu";
import { createTourSteps } from "./NextStepOnboarding";

const t = (key: string) => key;

function tour(name: string, options = {}) {
  const found = createTourSteps(t, "7", options).find((x) => x.tour === name);
  if (!found) throw new Error(`no ${name}`);
  return found.steps;
}

const allVisible = {
  requirementsEnabled: true,
  failureTriageEnabled: true,
  canSeeSharedSteps: true,
  canSeeReports: true,
  canSeeSettings: true,
  canSeeAuditLogs: true,
};

describe("mainTour", () => {
  it("ends by naming the Demo Project tour only when there is a Demo Project", () => {
    const lastContent = (options: object) =>
      tour("mainTour", options).at(-1)!.content;
    expect(lastContent({ hasDemoProject: true })).toBe(
      "help.tour.mainTour.project.contentWithDemo"
    );
    expect(lastContent({})).toBe("help.tour.mainTour.project.content");
  });
});

describe("projectTour", () => {
  it("leaves out the steps for menu entries the viewer does not see", () => {
    const selectors = tour("projectTour").map((step) => step.selector);
    expect(selectors).not.toContain("#project-requirements-link");
    expect(selectors).not.toContain("#project-triage-link");
    expect(selectors).not.toContain("#audit-logs-link");
    expect(selectors).not.toContain("#shared-steps-link");
  });

  it("follows the project menu's order when every entry is visible", () => {
    expect(
      tour("projectTour", allVisible).map((step) => step.selector)
    ).toEqual([
      "[data-testid='project-dropdown-trigger']",
      "[data-testid='project-menu-section-project']",
      "#project-requirements-link",
      "#test-cases-link",
      "#shared-steps-link",
      "#test-runs-link",
      "#exploratory-link",
      "#project-tags-link",
      "#project-issues-link",
      "#project-triage-link",
      "#reports-link",
      "#audit-logs-link",
      "#settings-integrations-link",
    ]);
  });

  it("routes each step to the page of the next step's link", () => {
    const steps = tour("projectTour", allVisible);
    const routeAfter = (selector: string) =>
      steps[steps.findIndex((step) => step.selector === selector) - 1]
        .nextRoute;
    expect(routeAfter("#project-requirements-link")).toBe(
      "/projects/requirements/7"
    );
    expect(routeAfter("#project-triage-link")).toBe("/projects/triage/7");
    expect(routeAfter("#audit-logs-link")).toBe("/projects/audit-logs/7");
    expect(routeAfter("#settings-integrations-link")).toBe(
      "/projects/settings/7/integrations"
    );
  });

  it("offers no skip on the last step only", () => {
    const steps = tour("projectTour", allVisible);
    expect(steps.at(-1)?.showSkip).toBe(false);
    expect(steps.slice(0, -1).every((step) => step.showSkip)).toBe(true);
  });
});

describe("adminTour", () => {
  it("has a welcome step and then one step per admin menu section", () => {
    const steps = tour("adminTour");
    const sections = getAdminMenuSections();
    expect(steps).toHaveLength(sections.length + 1);
    expect(steps.slice(1).map((step) => step.selector)).toEqual(
      sections.map(
        (section) => `[data-testid='admin-menu-section-trigger-${section.key}']`
      )
    );
    expect(steps.slice(1).map((step) => step.title)).toEqual(
      sections.map((section) => `admin.menu.${section.key}`)
    );
  });

  it("lists every page of a section in its step", () => {
    const steps = tour("adminTour");
    const sections = getAdminMenuSections();
    const system = sections.findIndex((section) => section.key === "system");
    render(<>{steps[system + 1].content}</>);
    expect(
      screen.getByText("help.tour.adminTour.sections.system")
    ).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(
      sections[system].items.length
    );
    expect(screen.getByText("admin.menu.attachments")).toBeInTheDocument();
    expect(screen.getByText("admin.menu.trash")).toBeInTheDocument();
  });
});
