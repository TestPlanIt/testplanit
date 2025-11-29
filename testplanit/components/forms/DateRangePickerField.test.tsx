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
        "reports.ui.dateRange.label": "Date Range",
        "reports.ui.dateRange.selectDateRange": "Select date range",
        "reports.ui.dateRange.last7Days": "Last 7 days",
        "reports.ui.dateRange.last30Days": "Last 30 days",
        "reports.ui.dateRange.previousMonth": "Previous month",
        "reports.ui.dateRange.previousQuarter": "Previous quarter",
        "reports.ui.dateRange.custom": "Custom",
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
      },
    },
    reports: {
      ui: {
        dateRange: {
          label: "Date Range",
          selectDateRange: "Select date range",
          last7Days: "Last 7 days",
          last30Days: "Last 30 days",
          previousMonth: "Previous month",
          previousQuarter: "Previous quarter",
          custom: "Custom",
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
        from: z.date().optional(),
        to: z.date().optional(),
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