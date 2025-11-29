import React, { ReactElement } from "react";
import { render, RenderOptions } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

// Define messages for tests
const messages = {
  common: {
    status: {
      loading: "Loading...",
      pending: "Pending",
      completed: "Completed",
      active: "Active",
    },
    labels: {
      noElapsedTime: "No time recorded",
      noResults: "No results yet",
      viewTestRunDetails: "View test run details",
      untested: "Untested",
      total: "Total",
      resultsWithNoElapsedTime: "Results recorded, but no time elapsed",
    },
    fields: {
      totalElapsed: "Total time",
      estimate: "Estimate",
      elapsed: "Elapsed",
      steps: "Steps",
    },
    plural: {
      case: "{count, plural, =0 {cases} =1 {case} other {cases}}",
    },
    // Add other common keys needed across many component tests here
  },
  // Add namespace and keys for UserDropdownMenu
  userMenu: {
    viewProfile: "View Profile",
    theme: "Theme",
    language: "Language",
    signOut: "Sign Out",
    themes: {
      // Add nested theme names if needed by the test
      light: "Light",
      dark: "Dark",
      system: "System",
      green: "Green",
      orange: "Orange",
      purple: "Purple",
    },
    // Add other userMenu keys if needed
  },
  runs: {
    summary: {
      totalCases: "{count} cases",
      totalElapsed: "Total time: {time}",
      lastExecuted: "Last executed: {date} by {user}",
      lastResultStatus: "Last result: {status}",
      tooltipStatus: "{status} ({percentage}%)",
    },
  },
  sessions: {
    actions: {
      viewSessionDetails: "View session details",
    },
    placeholders: {
      noElapsedTime: "No time recorded",
    },
    labels: {
      totalElapsed: "Total Elapsed",
      remaining: "{time} remaining",
      overtime: "{time} overtime",
    },
  },
  search: {
    allTypes: "All Types",
    typesSelected: "{count} types selected",
    placeholder: {
      thisProject: "Search in this project...",
      allProjects: "Search in all projects...",
    },
    currentProjectOnly: "Current project only",
    errors: {
      searchFailed: "Search failed",
      tryAgain: "Try Again",
    },
    results: {
      noResults: "No results found",
      tryAdjusting: "Try adjusting your search criteria",
      searchingFor: "Searching for",
      in: "in",
      within: "within",
      currentProject: "current project",
      showing: "Showing",
      of: "of",
      results: "results",
      page: "Page",
    },
    filters: {
      active: "filters",
    },
    startTyping: "Start typing to search...",
  },
  // Add other namespaces if needed
};

const AllTheProviders = ({ children }: { children: React.ReactNode }) => {
  // Add other global providers here if needed (Theme, State Management, etc.)
  return (
    // Cast messages to any to bypass strict type checking in tests
    <NextIntlClientProvider locale="en-US" messages={messages as any}>
      {children}
    </NextIntlClientProvider>
  );
};

const customRender = (
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">
) => render(ui, { wrapper: AllTheProviders, ...options });

// Re-export everything from testing-library
export * from "@testing-library/react";

// Override render method
export { customRender as render };
