import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AbstractIntlMessages } from "next-intl";
import { NextIntlClientProvider } from "next-intl";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import { DateRangePickerField } from "./DateRangePickerField";

// Mock next-intl
vi.mock("next-intl", async () => {
  const actual = await vi.importActual<typeof import("next-intl")>("next-intl");
  return {
    ...actual,
    useLocale: () => "en-US",
    useTranslations: () => (key: string) => {
      const translations: Record<string, string> = {
        "common.actions.clear": "Clear",
        "common.actions.reset": "Reset",
        "common.actions.done": "Done",
        "reports.ui.dateRange.label": "Date Range",
        "reports.ui.dateRange.selectDateRange": "Select date range",
        "reports.ui.dateRange.chooseStartDate": "Choose start date",
        "reports.ui.dateRange.chooseEndDate": "Choose end date",
        "reports.ui.dateRange.categories.day": "Day",
        "reports.ui.dateRange.categories.week": "Week",
        "reports.ui.dateRange.categories.month": "Month",
        "reports.ui.dateRange.categories.quarter": "Quarter",
        "reports.ui.dateRange.categories.year": "Year",
        "reports.ui.dateRange.today": "Today",
        "reports.ui.dateRange.yesterday": "Yesterday",
        "common.operators.last7": "Last 7 days",
        "common.operators.last30": "Last 30 days",
        "reports.ui.dateRange.thisWeek": "This week",
        "reports.ui.dateRange.lastWeek": "Last week",
        "reports.ui.dateRange.last2Weeks": "Last 2 weeks",
        "reports.ui.dateRange.thisMonth": "This month",
        "reports.ui.dateRange.lastMonth": "Last month",
        "reports.ui.dateRange.last3Months": "Last 3 months",
        "reports.ui.dateRange.thisQuarter": "This quarter",
        "reports.ui.dateRange.lastQuarter": "Last quarter",
        "common.operators.thisYear": "This year",
        "reports.ui.dateRange.lastYear": "Last year",
        "reports.ui.dateRange.last12Months": "Last 12 months",
        "reports.ui.dateRange.allTime": "All Time",
        "reports.ui.dateRange.custom": "Custom Date Range",
      };
      return translations[key] || key;
    },
  };
});

// Test wrapper component
const TestWrapper = ({ children }: { children: React.ReactNode }) => {
  const messages = {
    common: {
      actions: {
        clear: "Clear",
        reset: "Reset",
        done: "Done",
      },
    },
    reports: {
      ui: {
        dateRange: {
          label: "Date Range",
          selectDateRange: "Select date range",
          chooseStartDate: "Choose start date",
          chooseEndDate: "Choose end date",
          categories: {
            day: "Day",
            week: "Week",
            month: "Month",
            quarter: "Quarter",
            year: "Year",
          },
          today: "Today",
          yesterday: "Yesterday",
          last7Days: "Last 7 days",
          last30Days: "Last 30 days",
          thisWeek: "This week",
          lastWeek: "Last week",
          last2Weeks: "Last 2 weeks",
          thisMonth: "This month",
          lastMonth: "Last month",
          last3Months: "Last 3 months",
          thisQuarter: "This quarter",
          lastQuarter: "Last quarter",
          thisYear: "This year",
          lastYear: "Last year",
          last12Months: "Last 12 months",
          allTime: "All Time",
          custom: "Custom Date Range",
        },
      },
    },
  };

  return (
    <NextIntlClientProvider
      messages={messages as AbstractIntlMessages}
      locale="en-US"
    >
      {children}
    </NextIntlClientProvider>
  );
};

// Component with form for testing
const DateRangePickerWithForm = ({ defaultValue, ...props }: any) => {
  const formSchema = z.object({
    dateRange: z
      .object({
        from: z.date().nullable().optional(),
        to: z.date().nullable().optional(),
      })
      .optional(),
  });

  const form = useForm({
    resolver: standardSchemaResolver(formSchema),
    defaultValues: {
      dateRange: defaultValue,
    },
  });

  return (
    <FormProvider {...form}>
      <DateRangePickerField
        control={form.control}
        name="dateRange"
        {...props}
      />
    </FormProvider>
  );
};

describe("DateRangePickerField", () => {
  it("renders with label and placeholder", () => {
    render(
      <TestWrapper>
        <DateRangePickerWithForm
          label="Test Date Range"
          placeholder="Select dates"
        />
      </TestWrapper>
    );

    expect(screen.getByText("Test Date Range")).toBeInTheDocument();
    expect(screen.getByText("Select dates")).toBeInTheDocument();
  });

  it("renders with default placeholder when no placeholder provided", () => {
    render(
      <TestWrapper>
        <DateRangePickerWithForm />
      </TestWrapper>
    );

    expect(screen.getByText("dateRange.selectDateRange")).toBeInTheDocument();
  });

  it("displays disabled state correctly", () => {
    render(
      <TestWrapper>
        <DateRangePickerWithForm disabled={true} />
      </TestWrapper>
    );

    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
  });

  it("displays help popover when helpKey is provided", () => {
    render(
      <TestWrapper>
        <DateRangePickerWithForm
          label="Date Range"
          helpKey="reportBuilder.dateRange"
        />
      </TestWrapper>
    );

    expect(screen.getByText("Date Range")).toBeInTheDocument();
  });

  describe("relative ranges", () => {
    const openPicker = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByTestId("date-range-button"));
      await user.click(screen.getByTestId("date-range-preset-select"));
    };

    it("names a controlled preset on the trigger beside its dates", () => {
      render(
        <TestWrapper>
          <DateRangePickerWithForm
            preset={{ preset: "lastWeek" }}
            defaultValue={{
              from: new Date(2026, 8, 14),
              to: new Date(2026, 8, 20),
            }}
          />
        </TestWrapper>
      );
      const trigger = screen.getByTestId("date-range-button");
      expect(trigger).toHaveTextContent("dateRange.lastWeek");
      expect(trigger).toHaveTextContent("Sep 14, 2026 – Sep 20, 2026");
    });

    it("reports a rolling window and lets its size be edited", async () => {
      const user = userEvent.setup();
      const onPresetChange = vi.fn();
      render(
        <TestWrapper>
          <DateRangePickerWithForm
            onPresetChange={onPresetChange}
            timezone="Etc/UTC"
          />
        </TestWrapper>
      );
      await openPicker(user);
      await user.click(screen.getByTestId("date-range-preset-rolling"));

      expect(onPresetChange).toHaveBeenLastCalledWith({
        preset: "lastN",
        amount: 7,
        unit: "days",
      });
      expect(screen.getByTestId("date-range-rolling-editor")).toBeVisible();
      // The trigger now shows the resolved dates.
      expect(screen.getByTestId("date-range-button")).toHaveTextContent("–");

      fireEvent.change(screen.getByTestId("date-range-rolling-amount"), {
        target: { value: "14" },
      });
      expect(onPresetChange).toHaveBeenLastCalledWith({
        preset: "lastN",
        amount: 14,
        unit: "days",
      });
      // Out-of-range sizes are ignored rather than applied.
      fireEvent.change(screen.getByTestId("date-range-rolling-amount"), {
        target: { value: "0" },
      });
      expect(onPresetChange).toHaveBeenLastCalledWith({
        preset: "lastN",
        amount: 14,
        unit: "days",
      });
    });

    it("drops the preset when dates are picked on the calendar", async () => {
      const user = userEvent.setup();
      const onPresetChange = vi.fn();
      const { container } = render(
        <TestWrapper>
          <DateRangePickerWithForm
            preset={{ preset: "today" }}
            onPresetChange={onPresetChange}
            defaultValue={{ from: new Date(), to: new Date() }}
          />
        </TestWrapper>
      );
      await user.click(screen.getByTestId("date-range-button"));
      const day = container.ownerDocument.querySelector(
        "td[data-day] button"
      ) as HTMLElement | null;
      expect(day).not.toBeNull();
      await user.click(day!);
      expect(onPresetChange).toHaveBeenLastCalledWith(null);
    });

    it("clears the preset with the range", async () => {
      const user = userEvent.setup();
      const onPresetChange = vi.fn();
      render(
        <TestWrapper>
          <DateRangePickerWithForm
            preset={{ preset: "thisMonth" }}
            onPresetChange={onPresetChange}
            defaultValue={{ from: new Date(), to: new Date() }}
          />
        </TestWrapper>
      );
      await user.click(screen.getByTestId("date-range-button"));
      // This file's translation mock renders the bare key.
      await user.click(screen.getByText("clear"));
      expect(onPresetChange).toHaveBeenLastCalledWith(null);
    });
  });
});
