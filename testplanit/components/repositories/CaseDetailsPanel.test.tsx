import { describe, expect, it, vi } from "vitest";

// ---- Mocks (must come before imports) ----

// Stub the heavy details view — this test covers the panel chrome only.
vi.mock(
  "@/[locale]/projects/repository/[projectId]/[caseId]/TestCaseDetailsView",
  () => ({
    TestCaseDetailsView: vi.fn(
      ({ caseIdOverride }: { caseIdOverride?: string }) => (
        <div data-testid="test-case-details-view">case {caseIdOverride}</div>
      )
    ),
  })
);

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

vi.mock("~/lib/navigation", () => ({
  Link: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Radix tooltip needs a provider; pass-through keeps the test focused on chrome.
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <>{children}</>,
}));

// ---- Imports ----
import { fireEvent, render, screen } from "@testing-library/react";
import { CaseDetailsPanel } from "./CaseDetailsPanel";

function setup(
  overrides: Partial<Parameters<typeof CaseDetailsPanel>[0]> = {}
) {
  const props = {
    caseId: "14",
    projectId: "42",
    fullWidth: false,
    onToggleFullWidth: vi.fn(),
    onClose: vi.fn(),
    onPrev: vi.fn(),
    onNext: vi.fn(),
    hasPrev: false,
    hasNext: true,
    position: 1 as number | null,
    total: 35,
    ...overrides,
  };
  render(<CaseDetailsPanel {...props} />);
  return props;
}

describe("CaseDetailsPanel", () => {
  it("renders the details view for the given case", () => {
    setup();
    expect(screen.getByTestId("test-case-details-view")).toHaveTextContent(
      "case 14"
    );
  });

  it("renders the position within the full result set", () => {
    setup({ position: 1, total: 35 });
    expect(screen.getByTestId("case-details-position")).toHaveTextContent("35");
  });

  it("toggles full width", () => {
    const props = setup();
    fireEvent.click(screen.getByTestId("case-details-fullwidth-toggle"));
    expect(props.onToggleFullWidth).toHaveBeenCalledTimes(1);
  });

  it("closes", () => {
    const props = setup();
    fireEvent.click(screen.getByTestId("case-details-close"));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("disables Previous at the start and steps forward with Next", () => {
    const props = setup({ hasPrev: false, hasNext: true });
    expect(screen.getByTestId("case-details-prev")).toBeDisabled();
    const next = screen.getByTestId("case-details-next");
    expect(next).not.toBeDisabled();
    fireEvent.click(next);
    expect(props.onNext).toHaveBeenCalledTimes(1);
  });

  it("disables Next at the end", () => {
    setup({ hasNext: false, position: 35, total: 35 });
    expect(screen.getByTestId("case-details-next")).toBeDisabled();
  });

  it("navigates next/prev with arrow keys when nothing editable is focused", () => {
    const props = setup({ hasPrev: true, hasNext: true });
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(props.onNext).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    expect(props.onPrev).toHaveBeenCalledTimes(1);
  });

  it("does not navigate past the ends", () => {
    const props = setup({ hasPrev: false, hasNext: false });
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    expect(props.onNext).not.toHaveBeenCalled();
    expect(props.onPrev).not.toHaveBeenCalled();
  });

  it("ignores arrow keys while a text field is focused", () => {
    const props = setup({ hasNext: true });
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(props.onNext).not.toHaveBeenCalled();
    input.remove();
  });

  it("ignores arrow keys when a modifier is held", () => {
    const props = setup({ hasNext: true });
    fireEvent.keyDown(document.body, { key: "ArrowRight", metaKey: true });
    fireEvent.keyDown(document.body, { key: "ArrowRight", shiftKey: true });
    expect(props.onNext).not.toHaveBeenCalled();
  });
});
