import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpdatePI, mockToast } = vi.hoisted(() => ({
  mockUpdatePI: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    projectIntegration: { useUpdate: () => ({ mutateAsync: mockUpdatePI }) },
  }),
}));

vi.mock("sonner", () => ({ toast: mockToast }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key.split(".").pop() ?? key,
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, htmlFor }: any) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}));

import { ResultCommentsSettings } from "./result-comments-settings";

const githubApp = {
  id: 14,
  provider: "GITHUB",
  authType: "GITHUB_APP",
  name: "GitHub",
} as any;

function makeProjectIntegration(config: Record<string, any> | null = null) {
  return { id: "pi-1", projectId: 374, integrationId: 14, config } as any;
}

const getSwitch = () => screen.getByRole("switch", { name: "enableLabel" });
const getSaveButton = () => screen.getByRole("button", { name: "save" });

describe("ResultCommentsSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdatePI.mockResolvedValue({});
  });

  it("is off by default, with nothing to save", () => {
    render(
      <ResultCommentsSettings
        projectIntegration={makeProjectIntegration()}
        integration={githubApp}
      />
    );

    expect(screen.getByTestId("result-comments-section")).toBeInTheDocument();
    expect(getSwitch()).not.toBeChecked();
    expect(getSaveButton()).toBeDisabled();
  });

  it("shows nothing for a connection that cannot post: per-user OAuth, or another tracker", () => {
    const { container, rerender } = render(
      <ResultCommentsSettings
        projectIntegration={makeProjectIntegration()}
        integration={{ ...githubApp, authType: "OAUTH2" }}
      />
    );
    expect(container).toBeEmptyDOMElement();

    rerender(
      <ResultCommentsSettings
        projectIntegration={makeProjectIntegration()}
        integration={{ ...githubApp, provider: "JIRA", authType: "API_KEY" }}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("saves the switch beside the project's other integration settings, only on Save", async () => {
    const milestoneSync = { enabled: true, kinds: ["RELEASE"] };
    render(
      <ResultCommentsSettings
        projectIntegration={makeProjectIntegration({ milestoneSync })}
        integration={{ ...githubApp, authType: "PERSONAL_ACCESS_TOKEN" }}
      />
    );

    fireEvent.click(getSwitch());
    expect(getSwitch()).toBeChecked();
    expect(mockUpdatePI).not.toHaveBeenCalled();

    fireEvent.click(getSaveButton());

    await waitFor(() => expect(mockUpdatePI).toHaveBeenCalledTimes(1));
    expect(mockUpdatePI).toHaveBeenCalledWith({
      where: { id: "pi-1" },
      data: {
        config: { milestoneSync, resultComments: { enabled: true } },
      },
    });
    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
  });

  it("follows the saved value, and has nothing to save once it matches again", () => {
    const { rerender } = render(
      <ResultCommentsSettings
        projectIntegration={makeProjectIntegration({
          resultComments: { enabled: true },
        })}
        integration={githubApp}
      />
    );
    expect(getSwitch()).toBeChecked();

    fireEvent.click(getSwitch());
    expect(getSaveButton()).toBeEnabled();
    fireEvent.click(getSwitch());
    expect(getSaveButton()).toBeDisabled();

    rerender(
      <ResultCommentsSettings
        projectIntegration={makeProjectIntegration({
          resultComments: { enabled: false },
        })}
        integration={githubApp}
      />
    );
    expect(getSwitch()).toBeChecked();
    expect(getSaveButton()).toBeEnabled();
  });

  it("keeps the pending choice and reports a save that failed", async () => {
    mockUpdatePI.mockRejectedValue(new Error("denied"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ResultCommentsSettings
        projectIntegration={makeProjectIntegration()}
        integration={githubApp}
      />
    );

    fireEvent.click(getSwitch());
    fireEvent.click(getSaveButton());

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    expect(getSwitch()).toBeChecked();
    expect(getSaveButton()).toBeEnabled();
    logged.mockRestore();
  });
});
