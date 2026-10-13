import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations:
    (ns?: string) => (key: string, params?: Record<string, unknown>) => {
      const full = ns ? `${ns}.${key}` : key;
      return params ? `${full}:${Object.values(params).join("·")}` : full;
    },
}));

import { RequirementOverrideConfirmDialog } from "./RequirementOverrideConfirmDialog";

describe("RequirementOverrideConfirmDialog", () => {
  it.each([
    ["promote", "promoteTitle", "promoteConfirm"],
    ["exclude", "excludeTitle", "excludeConfirm"],
    ["reset", "resetTitle", "resetConfirm"],
  ] as const)(
    "renders the %s copy, naming the issue, and fires onConfirm only from the confirm button",
    (action, titleKey, confirmKey) => {
      const onConfirm = vi.fn();
      const onOpenChange = vi.fn();
      render(
        <RequirementOverrideConfirmDialog
          action={action}
          issueLabel="ABT-47364"
          open
          onOpenChange={onOpenChange}
          onConfirm={onConfirm}
        />
      );

      expect(
        screen.getByTestId("requirement-override-dialog")
      ).toHaveTextContent(`requirements.override.${titleKey}`);
      // The issue's key is interpolated into the description.
      expect(
        screen.getByTestId("requirement-override-dialog")
      ).toHaveTextContent("ABT-47364");
      expect(
        screen.getByTestId("requirement-override-confirm")
      ).toHaveTextContent(`requirements.override.${confirmKey}`);

      fireEvent.click(screen.getByTestId("requirement-override-cancel"));
      expect(onConfirm).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId("requirement-override-confirm"));
      expect(onConfirm).toHaveBeenCalledTimes(1);
    }
  );

  it("disables the confirm button while the conversion is pending", () => {
    render(
      <RequirementOverrideConfirmDialog
        action="promote"
        issueLabel="ABT-1"
        open
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
        isPending
      />
    );
    expect(screen.getByTestId("requirement-override-confirm")).toBeDisabled();
  });
});
