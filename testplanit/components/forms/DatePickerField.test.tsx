import { zodResolver } from "@hookform/resolvers/zod";
import { fireEvent, render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import { DatePickerField } from "./DatePickerField";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) => {
    const fullKey = namespace ? `${namespace}.${key}` : key;
    const map: Record<string, string> = {
      "common.actions.clear": "Clear",
    };
    return map[fullKey] ?? key.split(".").pop() ?? key;
  },
  useLocale: () => "en-US",
}));

// Mock date-fns locale resolution
vi.mock("~/utils/locales", () => ({
  getDateFnsLocale: () => undefined,
}));

// Mock HelpPopover to avoid complex rendering
vi.mock("@/components/ui/help-popover", () => ({
  HelpPopover: ({ helpKey }: any) => (
    <span data-testid="help-popover" data-key={helpKey} />
  ),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Test form wrapper
// ─────────────────────────────────────────────────────────────────────────────

const schema = z.object({
  dueDate: z.date().nullable().optional(),
});

type FormValues = z.infer<typeof schema>;

const DatePickerWithForm = ({
  defaultDate,
  disabled,
  label,
  placeholder,
  helpKey,
}: {
  defaultDate?: Date | null;
  disabled?: boolean;
  label?: string;
  placeholder?: string;
  helpKey?: string;
}) => {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      dueDate: defaultDate ?? null,
    },
  });

  return (
    <FormProvider {...form}>
      <DatePickerField
        control={form.control}
        name="dueDate"
        label={label}
        placeholder={placeholder}
        disabled={disabled}
        helpKey={helpKey}
      />
    </FormProvider>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("DatePickerField", () => {
  it("renders the date picker button", () => {
    render(<DatePickerWithForm />);

    // The popover trigger renders as a button
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("renders label when provided", () => {
    render(<DatePickerWithForm label="Due Date" />);

    expect(screen.getByText("Due Date")).toBeInTheDocument();
  });

  it("does not render label element when label prop is absent", () => {
    render(<DatePickerWithForm />);

    // No label text should appear (label=undefined means the label element is skipped)
    expect(screen.queryByRole("label")).not.toBeInTheDocument();
  });

  it("shows placeholder when no date is selected", () => {
    render(
      <DatePickerWithForm placeholder="Select a date" defaultDate={null} />
    );

    expect(screen.getByText("Select a date")).toBeInTheDocument();
  });

  it("renders the trigger button as disabled when disabled prop is true", () => {
    render(<DatePickerWithForm disabled={true} />);

    // The trigger button should be disabled
    const triggerBtn = screen.getAllByRole("button")[0];
    expect(triggerBtn).toBeDisabled();
  });

  it("renders the trigger button as enabled when not disabled", () => {
    render(<DatePickerWithForm disabled={false} />);

    const triggerBtn = screen.getAllByRole("button")[0];
    expect(triggerBtn).not.toBeDisabled();
  });

  it("shows formatted date text when a date is pre-selected", () => {
    // Use a fixed date for deterministic output
    const testDate = new Date(2024, 0, 15); // January 15, 2024
    render(<DatePickerWithForm defaultDate={testDate} />);

    // date-fns format("PPP") with en-US locale renders "January 15th, 2024"
    // The exact format depends on locale, but the year should be present
    const triggerBtn = screen.getAllByRole("button")[0];
    expect(triggerBtn.textContent).toContain("2024");
  });

  it("opens the calendar popover on trigger button click", () => {
    render(<DatePickerWithForm />);

    const triggerBtn = screen.getAllByRole("button")[0];
    fireEvent.click(triggerBtn);

    // Calendar renders grid elements after opening
    const calendar = screen.queryByRole("grid");
    expect(calendar).toBeInTheDocument();
  });

  it("renders HelpPopover when helpKey is provided", () => {
    render(<DatePickerWithForm label="Due Date" helpKey="myHelpKey" />);

    const helpPopover = screen.getByTestId("help-popover");
    expect(helpPopover).toBeInTheDocument();
    expect(helpPopover.getAttribute("data-key")).toBe("myHelpKey");
  });

  it("does not render HelpPopover when helpKey is absent", () => {
    render(<DatePickerWithForm label="Due Date" />);

    expect(screen.queryByTestId("help-popover")).not.toBeInTheDocument();
  });

  it("renders Clear button inside calendar popover", () => {
    render(<DatePickerWithForm />);

    // Open popover
    const triggerBtn = screen.getAllByRole("button")[0];
    fireEvent.click(triggerBtn);

    // The "Clear" button is rendered inside the popover content
    // Translation: useTranslations("common.actions"), t("clear") → "Clear"
    const clearBtn = screen.queryByText("Clear");
    expect(clearBtn).toBeInTheDocument();
  });

  it("CalendarDays icon is present in the trigger button", () => {
    render(<DatePickerWithForm />);

    // The CalendarDays icon renders as an SVG inside the trigger button
    const triggerBtn = screen.getAllByRole("button")[0];
    const svgIcon = triggerBtn.querySelector("svg");
    expect(svgIcon).toBeInTheDocument();
  });
});
