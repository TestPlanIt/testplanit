import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationTypePreferences } from "./NotificationTypePreferences";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

function switchFor(type: string) {
  return screen.getByTestId(`notification-type-switch-${type}`);
}

const onChange = vi.fn();

function renderEditable(value: string[] = [], isAdmin = false) {
  return render(
    <NotificationTypePreferences
      value={value}
      onChange={onChange}
      readOnly={false}
      isAdmin={isAdmin}
      effectiveMode="IN_APP"
    />
  );
}

describe("NotificationTypePreferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists every optional type switched on for a user who changed nothing", () => {
    renderEditable();

    expect(switchFor("WORK_ASSIGNED")).toHaveAttribute("aria-checked", "true");
    expect(switchFor("MILESTONE_DUE_REMINDER")).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(switchFor("WHATS_NEW")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("groups.assignments")).toBeInTheDocument();
    expect(screen.getByText("types.WORK_ASSIGNED.label")).toBeInTheDocument();
  });

  it("keeps each description in a help popover rather than inline", () => {
    renderEditable();

    expect(screen.queryByText("types.WORK_ASSIGNED.description")).toBeNull();
    const helpButtons = screen.getAllByRole("button", { name: "aria.help" });
    expect(helpButtons).toHaveLength(screen.getAllByRole("switch").length);

    fireEvent.click(helpButtons[0]);
    expect(
      screen.getByText("types.WORK_ASSIGNED.description")
    ).toBeInTheDocument();
  });

  it("hides admin-only types from a regular user and shows them to an admin", () => {
    const { unmount } = renderEditable([], false);
    expect(
      screen.queryByTestId("notification-type-switch-USER_REGISTERED")
    ).toBeNull();
    expect(
      screen.queryByTestId("notification-type-switch-LLM_BUDGET_ALERT")
    ).toBeNull();
    unmount();

    renderEditable([], true);
    expect(switchFor("USER_REGISTERED")).toBeInTheDocument();
    expect(switchFor("LLM_BUDGET_ALERT")).toBeInTheDocument();
    expect(screen.getByText("groups.administration")).toBeInTheDocument();
  });

  it("never lists a retired type", () => {
    renderEditable([], true);
    expect(
      screen.queryByTestId("notification-type-switch-COPY_MOVE_COMPLETE")
    ).toBeNull();
    expect(
      screen.queryByTestId(
        "notification-type-switch-GENERATE_FROM_URL_COMPLETE"
      )
    ).toBeNull();
  });

  it("shows locked types as on and disabled with a note, even while editing", () => {
    renderEditable();

    for (const type of ["INTEGRATION_AUTH_EXPIRED", "SYSTEM_ANNOUNCEMENT"]) {
      expect(switchFor(type)).toHaveAttribute("aria-checked", "true");
      expect(switchFor(type)).toBeDisabled();
    }
    expect(screen.getAllByText("typeSection.locked")).toHaveLength(2);
  });

  it("renders a muted type switched off", () => {
    renderEditable(["MILESTONE_DUE_REMINDER"]);

    expect(switchFor("MILESTONE_DUE_REMINDER")).toHaveAttribute(
      "aria-checked",
      "false"
    );
    expect(switchFor("WORK_ASSIGNED")).toHaveAttribute("aria-checked", "true");
  });

  it("is read-only outside edit mode: switches disabled, no reset button", () => {
    render(
      <NotificationTypePreferences
        value={["MILESTONE_DUE_REMINDER"]}
        readOnly={true}
        isAdmin={false}
        effectiveMode="IN_APP"
      />
    );

    expect(switchFor("WORK_ASSIGNED")).toBeDisabled();
    expect(switchFor("MILESTONE_DUE_REMINDER")).toBeDisabled();
    expect(switchFor("MILESTONE_DUE_REMINDER")).toHaveAttribute(
      "aria-checked",
      "false"
    );
    expect(screen.queryByTestId("notification-types-reset")).toBeNull();
  });

  it("switching a type off reports the new muted set", () => {
    renderEditable();

    fireEvent.click(switchFor("MILESTONE_DUE_REMINDER"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(["MILESTONE_DUE_REMINDER"]);
  });

  it("switching a muted type back on removes only that type", () => {
    renderEditable(["MILESTONE_DUE_REMINDER", "WHATS_NEW"]);

    fireEvent.click(switchFor("WHATS_NEW"));

    expect(onChange).toHaveBeenCalledWith(["MILESTONE_DUE_REMINDER"]);
  });

  it("reset to defaults reports an empty set and is disabled when nothing is muted", () => {
    const { unmount } = renderEditable();
    expect(screen.getByTestId("notification-types-reset")).toBeDisabled();
    unmount();

    renderEditable(["WORK_ASSIGNED"]);
    const reset = screen.getByTestId("notification-types-reset");
    expect(reset).toBeEnabled();
    fireEvent.click(reset);

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("explains that nothing is delivered while the effective mode is None", () => {
    const { unmount } = renderEditable();
    expect(
      screen.queryByTestId("notification-types-mode-none-note")
    ).toBeNull();
    unmount();

    render(
      <NotificationTypePreferences
        value={[]}
        onChange={onChange}
        readOnly={false}
        isAdmin={false}
        effectiveMode="NONE"
      />
    );

    expect(
      screen.getByTestId("notification-types-mode-none-note")
    ).toBeInTheDocument();
    // Still editable: the switches are not disabled by the mode.
    expect(switchFor("WORK_ASSIGNED")).toBeEnabled();
  });
});
