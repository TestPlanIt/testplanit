import "@testing-library/jest-dom";
import React from "react";
import { afterAll, beforeAll, vi } from "vitest";

// v3 grouped data hooks come from `useClientQueries(schema).<model>.useX()`,
// which calls React context internally and throws "Cannot read 'useContext' of
// null" when rendered without the app providers. Stub useClientQueries so every
// model/operation returns an inert query/mutation result, letting component
// renders mount. Tests that assert on hook-driven data still vi.mock the module
// locally (per-file mocks override this global stub).
vi.mock("@zenstackhq/tanstack-query/react", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const queryResult = () => ({
    data: undefined,
    isLoading: false,
    isPending: false,
    isError: false,
    isSuccess: true,
    error: null,
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
  });
  const mutationResult = () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    reset: vi.fn(),
  });
  const ops = new Proxy(
    {},
    {
      get: (_t, op: string | symbol) => {
        if (typeof op !== "string") return undefined;
        const isMutation = /^use(Create|Update|Upsert|Delete)/.test(op);
        return () => (isMutation ? mutationResult() : queryResult());
      },
    }
  );
  const models = new Proxy({}, { get: () => ops });
  return { ...actual, useClientQueries: () => models };
});

// The app's root <TooltipProvider> lives in app/providers.tsx, which test
// renders don't include. Without a provider in scope Radix's <Tooltip>
// throws "Tooltip must be used within TooltipProvider". Stub the module so
// every tooltip primitive is a transparent pass-through in tests; tests
// that need to assert on tooltip structure can still vi.mock the module
// locally (per-file mocks override this global stub).
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  // Radix's TooltipTrigger renders a <button> by default and merges props
  // onto its child when `asChild` is set. Match that so tests that assert on
  // the trigger's tag name (e.g. Avatar wraps its image in a button) still
  // see the right shape.
  TooltipTrigger: ({
    children,
    asChild,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => (asChild ? <>{children}</> : <button type="button">{children}</button>),
  // TooltipContent is portaled and only rendered while open in real Radix;
  // emit nothing by default so its children don't double up alongside the
  // trigger's children in queries like getByText.
  TooltipContent: () => null,
  // TooltipPortal: same — closed by default.
  TooltipPortal: () => null,
}));

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
const stableSearchParams = new URLSearchParams();
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
  // Referentially stable like the real hook — a fresh object per call makes
  // any consumer that uses it as a dependency (e.g. DataTable's initial
  // column-visibility callback) churn on every render.
  useSearchParams: () => stableSearchParams,
  useParams: () => ({}), // Default route params
  // next-intl's `createNavigation` internally calls `getRedirectFn(redirect)`
  // and `getRedirectFn(permanentRedirect)` at import time — they must be
  // defined (even as no-op stubs) for any module that imports
  // `~/lib/navigation` to load under vitest.
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
  notFound: vi.fn(),
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

// If your tests rely on window.matchMedia, you might need to mock it.
// Guarded so the global setup file is safe to load in per-file
// `// @vitest-environment node` tests (live-DB integration tests have no
// jsdom window). Without the guard, `Object.defineProperty(window, ...)`
// throws ReferenceError before any node-env test can run.
if (typeof window !== "undefined") {
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
}

// Mock ResizeObserver for components that use it (like async-combobox).
// `global` is defined in both jsdom and node, so this is safe everywhere.
class MockResizeObserver {
  constructor(_callback?: ResizeObserverCallback) {}
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
global.ResizeObserver = MockResizeObserver as any;

// jsdom doesn't implement requestIdleCallback. The SSE stream helpers defer
// their EventSource connection to the first idle callback (see
// hooks/deferredEventSource.ts). Collapsing it to a synchronous call here lets
// the stream unit tests exercise connection logic without threading timers
// through every assertion; deferredEventSource.test.ts overrides these locally
// to verify the deferral timing itself.
if (typeof global.requestIdleCallback === "undefined") {
  global.requestIdleCallback = ((cb: () => void) => {
    cb();
    return 0;
  }) as unknown as typeof global.requestIdleCallback;
  global.cancelIdleCallback =
    (() => {}) as unknown as typeof global.cancelIdleCallback;
}

// jsdom doesn't implement elementFromPoint, which TipTap's placeholder
// viewport tracking calls via prosemirror's posAtCoords on editor mount.
// Guarded like the matchMedia mock above so node-env tests (no `Document`)
// can still load this shared setup file.
if (typeof Document !== "undefined" && !Document.prototype.elementFromPoint) {
  Document.prototype.elementFromPoint = () => null;
}

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
  passwordStrength: {
    veryWeak: "Very Weak",
    weak: "Weak",
    fair: "Fair",
    good: "Good",
    strong: "Strong",
    minLength: "At least {count} characters",
    uppercase: "At least one uppercase letter",
    lowercase: "At least one lowercase letter",
    numbers: "At least one number",
    specialChars: "Special character from: {chars}",
  },
};

vi.mock("next-intl", () => {
  // Helper to get nested property safely
  const getNested = (obj: any, path: string): string | undefined => {
    try {
      return path.split(".").reduce((acc, part) => acc && acc[part], obj);
    } catch {
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
      const lookup = (key: string): string | undefined => {
        let message: string | undefined;

        if (namespace) {
          // Handle namespaces with dots (e.g., "common.status")
          const namespaceParts = namespace.split(".");
          const topLevelNamespace = namespaceParts[0] as keyof typeof messages;
          const nestedNamespacePath = namespaceParts.slice(1).join(".");
          const fullKeyPath = nestedNamespacePath
            ? `${nestedNamespacePath}.${key}`
            : key;

          const baseMessages = messages[topLevelNamespace];
          if (baseMessages) {
            message = getNested(baseMessages, fullKeyPath);
          }
        } else {
          message = getNested(messages, key);
        }

        return message;
      };

      // Return the actual translation function `t`
      const t = (key: string, params?: Record<string, any>) => {
        let message = lookup(key);

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

      // `t.rich(key, params)` — minimal renderer that lets tag-style chunks
      // (e.g. `<assignee></assignee>` in the i18n value) be replaced by
      // arbitrary React nodes returned by `params[tagName]()`. Tag-style
      // tokens (anything matching `<tag></tag>`) AND `{var}` placeholders
      // are both substituted in source order so the rendered output
      // mirrors what next-intl produces at runtime. This is the shape every
      // `t.rich(...)` consumer in the codebase needs.
      (t as any).rich = (
        key: string,
        params?: Record<
          string,
          ((chunks?: React.ReactNode) => React.ReactNode) | string | number
        >
      ): React.ReactNode => {
        const template =
          lookup(key) ?? (namespace ? `${namespace}.${key}` : key);
        const parts: React.ReactNode[] = [];
        const tokenRegex = /<(\w+)><\/\1>|\{(\w+)\}/g;
        let lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = tokenRegex.exec(template)) !== null) {
          if (match.index > lastIndex) {
            parts.push(template.slice(lastIndex, match.index));
          }
          const tagName = match[1];
          const placeholderName = match[2];
          if (tagName) {
            const renderFn = params?.[tagName];
            if (typeof renderFn === "function") {
              parts.push(renderFn());
            }
          } else if (placeholderName) {
            const val = params?.[placeholderName];
            parts.push(typeof val === "function" ? val() : String(val ?? ""));
          }
          lastIndex = tokenRegex.lastIndex;
        }
        if (lastIndex < template.length) {
          parts.push(template.slice(lastIndex));
        }
        return parts;
      };

      return t as ((key: string, params?: Record<string, any>) => string) & {
        rich: (
          key: string,
          params?: Record<
            string,
            ((chunks?: React.ReactNode) => React.ReactNode) | string | number
          >
        ) => React.ReactNode;
      };
    },
    // Add mocks for any other specific next-intl exports used in tests if needed
    // e.g., getTranslator: async () => (key) => key,
  };
});
