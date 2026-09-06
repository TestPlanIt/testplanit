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

import { CaseDraftRecoveryBanner } from "./CaseDraftRecoveryBanner";

const draft = (minutesAgo = 20) =>
  buildCaseDraftPayload(
    { name: "Half-written" },
    {},
    new Date(Date.now() - minutesAgo * 60_000)
  );

describe("CaseDraftRecoveryBanner", () => {
  it("renders nothing when there is no draft", () => {
    const { container } = render(
      <CaseDraftRecoveryBanner
        draft={null}
        onResume={vi.fn()}
        onDiscard={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("surfaces a draft on the read-only view, where a crash leaves the user", () => {
    // This is the whole point of the banner: after a crash the user lands on
    // the read view showing the last *saved* content, which is indistinguishable
    // from the work being gone. The restore dialog only appears once editing.
    render(
      <CaseDraftRecoveryBanner
        draft={draft()}
        onResume={vi.fn()}
        onDiscard={vi.fn()}
      />
    );
    const banner = screen.getByTestId("case-draft-recovery-banner");
    expect(banner).toHaveTextContent("You have unsaved changes");
    expect(banner).toHaveAttribute("role", "status");
  });

  it("says how old the unsaved work is", () => {
    render(
      <CaseDraftRecoveryBanner
        draft={draft(20)}
        onResume={vi.fn()}
        onDiscard={vi.fn()}
      />
    );
    expect(screen.getByText(/20 minutes ago/i)).toBeInTheDocument();
  });

  it("offers both resuming and discarding", async () => {
    const onResume = vi.fn();
    const onDiscard = vi.fn();
    const user = userEvent.setup();

    render(
      <CaseDraftRecoveryBanner
        draft={draft()}
        onResume={onResume}
        onDiscard={onDiscard}
      />
    );

    await user.click(screen.getByTestId("case-draft-banner-resume"));
    expect(onResume).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId("case-draft-banner-discard"));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("tolerates a draft whose timestamp is unusable", () => {
    // A corrupt savedAt must not take the banner — and with it the only route
    // back to the user's work — off the page.
    const broken = { ...draft(), savedAt: "not-a-date" };
    render(
      <CaseDraftRecoveryBanner
        draft={broken}
        onResume={vi.fn()}
        onDiscard={vi.fn()}
      />
    );
    expect(
      screen.getByTestId("case-draft-recovery-banner")
    ).toBeInTheDocument();
  });
});
