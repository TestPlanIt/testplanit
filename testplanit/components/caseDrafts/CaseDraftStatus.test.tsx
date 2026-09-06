import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
// Resolve against the real en-US.json rather than the hand-pasted subset in
// vitest.setup.tsx, so these assertions fail if the shipped copy changes.
vi.mock("next-intl", async () => {
  const messages = (await import("~/messages/en-US.json")).default as Record<
    string,
    unknown
  >;
  const get = (path: string) =>
    path
      .split(".")
      .reduce<any>((acc, part) => (acc ? acc[part] : undefined), messages);
  const fill = (template: unknown, values?: Record<string, unknown>) =>
    typeof template === "string"
      ? template.replace(/\{(\w+)\}/g, (_m, k) =>
          values && k in values ? String(values[k]) : `{${k}}`
        )
      : undefined;
  return {
    useLocale: () => "en-US",
    NextIntlClientProvider: ({ children }: any) => children,
    useTranslations:
      (namespace?: string) =>
      (key: string, values?: Record<string, unknown>) => {
        const full = namespace ? `${namespace}.${key}` : key;
        return fill(get(full), values) ?? full;
      },
  };
});

import { CaseDraftStatus } from "./CaseDraftStatus";

const SAVED_AT = new Date("2026-03-04T17:41:00.000Z");

describe("CaseDraftStatus", () => {
  it("renders nothing before anything has been typed", () => {
    // The editor must look untouched on open — an indicator sitting there
    // saying something about saving implies work is pending when none is.
    const { container } = render(
      <CaseDraftStatus status="idle" lastSavedAt={null} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("announces that a save is in flight", () => {
    render(<CaseDraftStatus status="saving" lastSavedAt={null} />);
    const el = screen.getByTestId("case-draft-status");
    expect(el).toHaveAttribute("data-status", "saving");
    expect(el).toHaveTextContent("Saving");
  });

  it("reports unsaved changes while the debounce is still running", () => {
    render(<CaseDraftStatus status="dirty" lastSavedAt={null} />);
    const el = screen.getByTestId("case-draft-status");
    expect(el).toHaveAttribute("data-status", "dirty");
    expect(el).toHaveTextContent("Unsaved changes");
  });

  it("states the failure and that it will retry, rather than just failing", () => {
    // The user's work is safe in localStorage at this point; the copy has to
    // say a retry is coming so nobody re-types everything into a new tab.
    render(<CaseDraftStatus status="error" lastSavedAt={SAVED_AT} />);
    const el = screen.getByTestId("case-draft-status");
    expect(el).toHaveAttribute("data-status", "error");
    expect(el).toHaveTextContent("Unable to save");
    expect(el).toHaveTextContent("retrying");
  });

  it("shows the time of the last successful save", () => {
    render(<CaseDraftStatus status="saved" lastSavedAt={SAVED_AT} />);
    const el = screen.getByTestId("case-draft-status");
    expect(el).toHaveAttribute("data-status", "saved");
    expect(el).toHaveTextContent("All changes saved");
    // Formatted through the viewer's locale/timezone preferences rather than
    // toLocaleTimeString, so assert a clock-shaped value rather than a fixed
    // string the test environment's zone would make brittle.
    expect(el.textContent).toMatch(/\d{1,2}:\d{2}/);
  });

  it("keeps the last-saved time visible after the status returns to idle", () => {
    // Going quiet is not the same as never having saved: the reassurance has
    // to persist once the form matches what was saved.
    render(<CaseDraftStatus status="idle" lastSavedAt={SAVED_AT} />);
    expect(screen.getByTestId("case-draft-status")).toHaveTextContent(
      "All changes saved"
    );
  });

  it("is announced politely to assistive technology", () => {
    render(<CaseDraftStatus status="saving" lastSavedAt={null} />);
    const el = screen.getByTestId("case-draft-status");
    expect(el).toHaveAttribute("role", "status");
    expect(el).toHaveAttribute("aria-live", "polite");
  });

  it("accepts extra classes so hosts can place it in their own layout", () => {
    render(
      <CaseDraftStatus
        status="saved"
        lastSavedAt={SAVED_AT}
        className="shrink-0 whitespace-nowrap"
      />
    );
    expect(screen.getByTestId("case-draft-status")).toHaveClass("shrink-0");
  });
});
