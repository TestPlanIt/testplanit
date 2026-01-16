import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DateRangePickerField } from "./DateRangePickerField";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v4";
import { NextIntlClientProvider } from "next-intl";

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
        "reports.ui.dateRange.last7Days": "Last 7 days",
        "reports.ui.dateRange.last30Days": "Last 30 days",
        "reports.ui.dateRange.thisWeek": "This week",
        "reports.ui.dateRange.lastWeek": "Last week",
        "reports.ui.dateRange.last2Weeks": "Last 2 weeks",
        "reports.ui.dateRange.thisMonth": "This month",
        "reports.ui.dateRange.lastMonth": "Last month",
        "reports.ui.dateRange.last3Months": "Last 3 months",
        "reports.ui.dateRange.thisQuarter": "This quarter",
        "reports.ui.dateRange.lastQuarter": "Last quarter",
        "reports.ui.dateRange.thisYear": "This year",
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
    <NextIntlClientProvider messages={messages} locale="en-US">
      {children}
    </NextIntlClientProvider>
  );
};

// Component with form for testing
const DateRangePickerWithForm = (props: any) => {
  const formSchema = z.object({
    dateRange: z
      .object({
        from: z.date().nullable().optional(),
        to: z.date().nullable().optional(),
      })
      .optional(),
  });

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      dateRange: undefined,
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
});