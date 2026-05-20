/**
 * Unit tests for the JunitIterationPropertyForm tag-input component.
 *
 * Covers the round-trip: render default state → add a tag → remove a tag
 * → submit. The PUT call is mocked via `global.fetch`; we assert the
 * outbound body shape so a regression in the form-to-API contract surfaces
 * here instead of in the API test.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockToastSuccess, mockToastError } = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: any[]) => mockToastSuccess(...args),
    error: (...args: any[]) => mockToastError(...args),
  },
}));

vi.mock("next-intl", () => ({
  useTranslations:
    (_namespace?: string) =>
    (key: string, params?: Record<string, unknown>) => {
      if (params) {
        let result = key;
        Object.entries(params).forEach(([k, v]) => {
          result = result.replace(`{${k}}`, String(v));
        });
        return result;
      }
      return key;
    },
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, ...rest }: any) => <div {...rest}>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children, ...rest }: any) => <h3 {...rest}>{children}</h3>,
  CardDescription: ({ children }: any) => <p>{children}</p>,
  CardContent: ({ children, className }: any) => (
    <div className={className}>{children}</div>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: ({ ...rest }: any) => <input {...rest} />,
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, ...rest }: any) => <label {...rest}>{children}</label>,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, ...rest }: any) => <span {...rest}>{children}</span>,
}));

vi.mock("lucide-react", () => ({
  Loader2: () => <svg data-testid="icon-loader" />,
  Plus: () => <svg data-testid="icon-plus" />,
  Save: () => <svg data-testid="icon-save" />,
  X: () => <svg data-testid="icon-x" />,
}));

import { JunitIterationPropertyForm } from "./junit-iteration-property-form";

describe("JunitIterationPropertyForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global as any).fetch = vi.fn();
  });

  it("renders the default hint when the initial list is empty", () => {
    render(<JunitIterationPropertyForm projectId={42} initialNames={[]} />);
    expect(
      screen.getByTestId("junit-iteration-property-default-hint")
    ).toBeDefined();
  });

  it("renders one badge per initial name and hides the default hint", () => {
    render(
      <JunitIterationPropertyForm
        projectId={42}
        initialNames={["iteration", "iterationIndex"]}
      />
    );
    expect(
      screen.queryByTestId("junit-iteration-property-default-hint")
    ).toBeNull();
    expect(
      screen.getByTestId("junit-iteration-property-tag-iteration")
    ).toBeDefined();
    expect(
      screen.getByTestId("junit-iteration-property-tag-iterationIndex")
    ).toBeDefined();
  });

  it("adds a tag when Add is clicked", () => {
    render(<JunitIterationPropertyForm projectId={42} initialNames={[]} />);
    const input = screen.getByTestId(
      "junit-iteration-property-input"
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "iteration" } });
    fireEvent.click(screen.getByTestId("junit-iteration-property-add"));
    expect(
      screen.getByTestId("junit-iteration-property-tag-iteration")
    ).toBeDefined();
    // Input is cleared after add.
    expect(input.value).toBe("");
  });

  it("removes a tag when its X is clicked", () => {
    render(
      <JunitIterationPropertyForm projectId={42} initialNames={["iteration"]} />
    );
    fireEvent.click(
      screen.getByTestId("junit-iteration-property-remove-iteration")
    );
    expect(
      screen.queryByTestId("junit-iteration-property-tag-iteration")
    ).toBeNull();
    // After removal the default hint reappears.
    expect(
      screen.getByTestId("junit-iteration-property-default-hint")
    ).toBeDefined();
  });

  it("submits the current names list as { propertyNames } via PUT", async () => {
    (global as any).fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ propertyNames: ["iteration", "extra"] }),
    });

    render(
      <JunitIterationPropertyForm projectId={42} initialNames={["iteration"]} />
    );
    // Save is gated on dirty state — add a tag first so the button enables.
    const input = screen.getByTestId(
      "junit-iteration-property-input"
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "extra" } });
    fireEvent.click(screen.getByTestId("junit-iteration-property-add"));
    fireEvent.click(screen.getByTestId("junit-iteration-property-save"));

    await waitFor(() => {
      expect((global as any).fetch).toHaveBeenCalledTimes(1);
    });
    const [url, init] = (global as any).fetch.mock.calls[0];
    expect(url).toBe("/api/projects/42/junit-iteration-property-names");
    expect(init.method).toBe("PUT");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({
      propertyNames: ["iteration", "extra"],
    });
    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalled();
    });
  });

  it("toasts an error when the API rejects the request", async () => {
    (global as any).fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Invalid request body" }),
    });

    render(
      <JunitIterationPropertyForm projectId={42} initialNames={["iteration"]} />
    );
    // Make the form dirty so Save is enabled.
    const input = screen.getByTestId(
      "junit-iteration-property-input"
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "extra" } });
    fireEvent.click(screen.getByTestId("junit-iteration-property-add"));
    fireEvent.click(screen.getByTestId("junit-iteration-property-save"));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
    });
  });

  it("dedupes when adding an existing tag (no duplicate badge)", () => {
    render(
      <JunitIterationPropertyForm projectId={42} initialNames={["iteration"]} />
    );
    const input = screen.getByTestId(
      "junit-iteration-property-input"
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "iteration" } });
    fireEvent.click(screen.getByTestId("junit-iteration-property-add"));
    // Still exactly one badge with that name.
    const tags = screen.getAllByTestId(
      /junit-iteration-property-tag-iteration$/
    );
    expect(tags).toHaveLength(1);
  });
});
