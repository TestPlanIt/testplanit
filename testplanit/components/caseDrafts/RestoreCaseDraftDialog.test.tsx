import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { buildCaseDraftPayload } from "~/lib/services/caseDraft";
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

import { RestoreCaseDraftDialog } from "./RestoreCaseDraftDialog";

const draft = (minutesAgo = 5) =>
  buildCaseDraftPayload(
    { name: "Half-written" },
    {},
    new Date(Date.now() - minutesAgo * 60_000)
  );

describe("RestoreCaseDraftDialog", () => {
  it("stays closed when there is no draft to offer", () => {
    render(
      <RestoreCaseDraftDialog
        draft={null}
        scopeKind="case"
        onRestore={vi.fn()}
        onDiscard={vi.fn()}
      />
    );
    expect(
      screen.queryByTestId("restore-case-draft-dialog")
    ).not.toBeInTheDocument();
  });

  it("asks about unsaved changes when editing an existing case", async () => {
    render(
      <RestoreCaseDraftDialog
        draft={draft()}
        scopeKind="case"
        onRestore={vi.fn()}
        onDiscard={vi.fn()}
      />
    );
    expect(screen.getByTestId("restore-case-draft-dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading")).toHaveTextContent(
      "Restore unsaved changes?"
    );
    expect(screen.getByText(/load the saved version/i)).toBeInTheDocument();
  });

  it("asks about an unsaved test case when authoring a new one", async () => {
    // A new case has no "saved version" to fall back to, so the copy has to
    // differ — discarding here means starting from nothing.
    render(
      <RestoreCaseDraftDialog
        draft={draft()}
        scopeKind="folder"
        onRestore={vi.fn()}
        onDiscard={vi.fn()}
      />
    );
    expect(screen.getByRole("heading")).toHaveTextContent(
      "Restore unsaved test case?"
    );
    expect(screen.getByText(/start fresh/i)).toBeInTheDocument();
  });

  it("tells the user how old the draft is", () => {
    render(
      <RestoreCaseDraftDialog
        draft={draft(5)}
        scopeKind="case"
        onRestore={vi.fn()}
        onDiscard={vi.fn()}
      />
    );
    expect(screen.getByText(/5 minutes ago/i)).toBeInTheDocument();
  });

  it("warns when the draft predates someone else's save", () => {
    // Restoring here silently reverts a colleague's work on the next save, so
    // the consequence has to be stated before the user chooses.
    render(
      <RestoreCaseDraftDialog
        draft={draft()}
        scopeKind="case"
        isStale
        onRestore={vi.fn()}
        onDiscard={vi.fn()}
      />
    );
    expect(
      screen.getByText(/saved by someone else since your draft was written/i)
    ).toBeInTheDocument();
  });

  it("omits the warning when the draft is current", () => {
    render(
      <RestoreCaseDraftDialog
        draft={draft()}
        scopeKind="case"
        onRestore={vi.fn()}
        onDiscard={vi.fn()}
      />
    );
    expect(
      screen.queryByText(/saved by someone else/i)
    ).not.toBeInTheDocument();
  });

  it("reports the user's choice", async () => {
    const onRestore = vi.fn();
    const onDiscard = vi.fn();
    const user = userEvent.setup();

    const { rerender } = render(
      <RestoreCaseDraftDialog
        draft={draft()}
        scopeKind="case"
        onRestore={onRestore}
        onDiscard={onDiscard}
      />
    );

    await user.click(screen.getByTestId("restore-case-draft-restore"));
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();

    rerender(
      <RestoreCaseDraftDialog
        draft={draft()}
        scopeKind="case"
        onRestore={onRestore}
        onDiscard={onDiscard}
      />
    );
    await user.click(screen.getByTestId("restore-case-draft-discard"));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("offers no way out except an explicit choice", () => {
    // Both answers destroy something — the draft, or the content on screen —
    // so there is deliberately no close button and no dismiss-on-outside-click.
    render(
      <RestoreCaseDraftDialog
        draft={draft()}
        scopeKind="case"
        onRestore={vi.fn()}
        onDiscard={vi.fn()}
      />
    );
    const dialog = screen.getByTestId("restore-case-draft-dialog");
    expect(dialog.querySelectorAll("button")).toHaveLength(2);
  });
});
