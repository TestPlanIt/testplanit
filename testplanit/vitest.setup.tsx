import "@testing-library/jest-dom";
import { vi, beforeAll, afterAll } from "vitest";
import React from "react";

// Suppress React's contentEditable warnings in tests
// TipTap editor triggers these warnings, which can cause worker crashes in CI
const originalError = console.error;
const originalWarn = console.warn;

beforeAll(() => {
  console.error = (...args: any[]) => {
    const message = typeof args[0] === "string" ? args[0] : "";
    // Suppress contentEditable React warnings
    if (
      message.includes("contentEditable") ||
      message.includes("children managed by React")
    ) {
      return;
    }
    originalError.call(console, ...args);
  };

  console.warn = (...args: any[]) => {
    const message = typeof args[0] === "string" ? args[0] : "";
    // Suppress contentEditable React warnings
    if (
      message.includes("contentEditable") ||
      message.includes("children managed by React")
    ) {
      return;
    }
    originalWarn.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
  console.warn = originalWarn;
});

// Mock canvas getContext to prevent errors from dependencies like is-emoji-supported
// This runs after jsdom is set up but before tests execute.
try {
  if (typeof HTMLCanvasElement !== "undefined") {
    HTMLCanvasElement.prototype.getContext = () => {
      // Return null or a basic mock if needed
      return null;
    };
  } else {
    console.warn("HTMLCanvasElement not found during setupFiles mock attempt.");
  }
} catch (error) {
  console.error("Error mocking canvas getContext in setupFiles:", error);
}

// Mock next/navigation hooks often used alongside next-intl
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => "/", // Default pathname
  useSearchParams: () => new URLSearchParams(), // Default search params
  useParams: () => ({}), // Default route params
}));

// Mock NextAuth useSession hook if tests require auth context
vi.mock("next-auth/react", async (importOriginal) => {
  const original = await importOriginal<typeof import("next-auth/react")>();
  return {
    ...original,
    useSession: vi.fn(() => ({
      data: {
        user: {
          id: "test-user-id",
          name: "Test User",
          email: "test@example.com",
        },
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 1 day expiry
      },
      status: "authenticated", // Mock as authenticated
      update: vi.fn(),
    })),
  };
});

// If your tests rely on window.matchMedia, you might need to mock it:
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver for components that use it (like async-combobox)
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
global.ResizeObserver = MockResizeObserver as any;

// --- Mock next-intl ---
// Mock the specific hooks and provider needed by the components under test

// Import messages (adjust path if needed, consider moving messages to a shared file)
// For simplicity here, we'll paste the messages object
const messages = {
  common: {
    loading: "Loading...",
    cancel: "Cancel",
    status: {
      loading: "Loading...",
      pending: "Pending",
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
      theme: "Theme",
      locale: "Language",
    },
    actions: {
      signOut: "Sign Out",
    },
    plural: {
      // Basic handling for plural - won't fully work but avoids errors for now
      case: "cases",
    },
  },
  userMenu: {
    viewProfile: "View Profile",
    theme: "Theme",
    language: "Language",
    signOut: "Sign Out",
    themes: {
      light: "Light",
      dark: "Dark",
      system: "System",
      green: "Green",
      orange: "Orange",
      purple: "Purple",
    },
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
};

vi.mock("next-intl", () => {
  // Helper to get nested property safely
  const getNested = (obj: any, path: string): string | undefined => {
    try {
      return path.split(".").reduce((acc, part) => acc && acc[part], obj);
    } catch (e) {
      return undefined;
    }
  };

  // Define the mock provider component separately
  const MockProvider = ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  );

  return {
    NextIntlClientProvider: MockProvider,
    useLocale: (): string => "en", // Mock useLocale

    // Mock useTranslations to look up keys in the messages object
    useTranslations: (namespace?: string) => {
      // Return the actual translation function `t`
      return (key: string, params?: Record<string, any>) => {
        let message: string | undefined;

        if (namespace) {
          // Handle namespaces with dots (e.g., "common.status")
          const namespaceParts = namespace.split(".");
          const topLevelNamespace = namespaceParts[0] as keyof typeof messages; // Namespace Lookup
          const nestedNamespacePath = namespaceParts.slice(1).join(".");
          const fullKeyPath = nestedNamespacePath
            ? `${nestedNamespacePath}.${key}`
            : key;

          const baseMessages = messages[topLevelNamespace];
          if (baseMessages) {
            message = getNested(baseMessages, fullKeyPath);
          }
        } else {
          // No namespace provided, try finding key directly from root (e.g., key is "common.labels.noResults")
          message = getNested(messages, key); // Root Lookup
        }

        // Fallback if still not found
        if (message === undefined) {
          message = namespace ? `${namespace}.${key}` : key;
        }

        // Basic placeholder replacement (won't handle ICU plurals/selects)
        if (params && typeof message === "string") {
          Object.entries(params).forEach(([paramKey, paramValue]) => {
            message = message!.replace(`{${paramKey}}`, String(paramValue));
          });
        }
        // Ensure we return a string even if lookup failed and we ended up with undefined
        return typeof message === "string" ? message : String(message);
      };
    },
    // Add mocks for any other specific next-intl exports used in tests if needed
    // e.g., getTranslator: async () => (key) => key,
  };
});
