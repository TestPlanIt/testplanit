import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations:
    (namespace?: string) => (key: string, values?: Record<string, unknown>) =>
      `${namespace}.${key}${values ? JSON.stringify(values) : ""}`,
}));

import { ConfirmTemplateSwitchDialog } from "./ConfirmTemplateSwitchDialog";

const pending = {
  templateId: 7,
  templateName: "Regression",
  lostFields: ["Preconditions", "Browser"],
};

describe("ConfirmTemplateSwitchDialog", () => {
  it("stays closed when no switch is pending", () => {
    render(
      <ConfirmTemplateSwitchDialog
        pending={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(
      screen.queryByTestId("confirm-template-switch-dialog")
    ).not.toBeInTheDocument();
  });

  it("names the template and every field the switch discards", () => {
    render(
      <ConfirmTemplateSwitchDialog
        pending={pending}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const dialog = screen.getByTestId("confirm-template-switch-dialog");
    expect(dialog).toHaveTextContent('"templateName":"Regression"');
    expect(dialog).toHaveTextContent('"count":2');
    expect(screen.getByText("Preconditions")).toBeInTheDocument();
    expect(screen.getByText("Browser")).toBeInTheDocument();
  });

  it("confirms the switch", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmTemplateSwitchDialog
        pending={pending}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );
    await userEvent.click(
      screen.getByTestId("confirm-template-switch-confirm")
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("cancels without confirming", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmTemplateSwitchDialog
        pending={pending}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    await userEvent.click(screen.getByTestId("confirm-template-switch-cancel"));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
