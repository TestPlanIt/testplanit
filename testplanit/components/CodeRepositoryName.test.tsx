import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CodeRepositoryName } from "./CodeRepositoryName";

describe("CodeRepositoryName", () => {
  it("renders the repository icon before the name", () => {
    const { container } = render(
      <CodeRepositoryName name="acme/app" data-testid="repo" />
    );
    const root = screen.getByTestId("repo");
    expect(root).toHaveTextContent("acme/app");
    const icon = container.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(root.firstElementChild).toBe(icon);
  });

  it("appends the provider badge and branch only when given", () => {
    render(
      <CodeRepositoryName
        name="acme/app"
        provider="GITHUB"
        branch="main"
        data-testid="repo"
      />
    );
    const root = screen.getByTestId("repo");
    expect(root).toHaveTextContent("GITHUB");
    expect(root).toHaveTextContent("main");
    const { container } = render(<CodeRepositoryName name="bare" />);
    expect(container.textContent).toBe("bare");
  });
});
