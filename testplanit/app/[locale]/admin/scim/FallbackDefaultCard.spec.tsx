import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { DowngradedUser } from "~/app/actions/scimMappingActions";
import type { AppConfig } from "@prisma/client";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string, params?: any) => {
    if (!namespace) return key;
    if (params && typeof params === "object") {
      return `${namespace}.${key}(${JSON.stringify(params)})`;
    }
    return `${namespace}.${key}`;
  },
}));

// Mock sonner
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

// Mock shadcn Select as a native <select> to avoid Radix hasPointerCapture in jsdom
const { SelectTriggerSentinel, SelectItemSentinel } = vi.hoisted(() => ({
  SelectTriggerSentinel: Symbol("SelectTrigger"),
  SelectItemSentinel: Symbol("SelectItem"),
}));

vi.mock("@/components/ui/select", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  function Select({ children, value, onValueChange }: any) {
    const items: Array<{ value: string; label: React.ReactNode }> = [];
    let triggerProps: Record<string, unknown> = {};
    const walk = (nodes: React.ReactNode) => {
      React.Children.forEach(nodes, (child: any) => {
        if (!React.isValidElement(child)) return;
        const elementType: any = (child as any).type;
        const props: any = (child as any).props ?? {};
        if (elementType?.__sentinel === SelectTriggerSentinel) {
          const { children: _c, ...rest } = props;
          triggerProps = rest;
        } else if (elementType?.__sentinel === SelectItemSentinel) {
          items.push({ value: props.value, label: props.children });
        }
        if (props.children) walk(props.children);
      });
    };
    walk(children);
    return (
      <select
        value={value ?? ""}
        onChange={(e) => onValueChange?.(e.target.value)}
        {...(triggerProps as any)}
      >
        {items.map((it) => (
          <option key={it.value} value={it.value}>
            {String(it.label)}
          </option>
        ))}
      </select>
    );
  }
  function SelectTrigger({ children, ...rest }: any) {
    return (
      <span {...rest} style={{ display: "none" }}>
        {children}
      </span>
    );
  }
  (SelectTrigger as any).__sentinel = SelectTriggerSentinel;
  function SelectItem({ value, children, ...rest }: any) {
    return (
      <span value={value} {...rest} style={{ display: "none" }}>
        {children}
      </span>
    );
  }
  (SelectItem as any).__sentinel = SelectItemSentinel;
  return {
    Select,
    SelectContent: ({ children }: any) => <>{children}</>,
    SelectItem,
    SelectTrigger,
    SelectValue: ({ children }: any) => <span>{children}</span>,
  };
});

const {
  mockUpsertMutateAsync,
  mockPreviewFallbackDefaultChange,
  mockEnqueueFallbackDefaultRecompute,
  stableConfig,
} = vi.hoisted(() => {
  const stableConfig = {
    key: "scim.defaultMappedAccess",
    value: "USER",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as AppConfig;
  return {
    mockUpsertMutateAsync: vi.fn().mockResolvedValue(stableConfig),
    mockPreviewFallbackDefaultChange: vi.fn().mockResolvedValue({
      success: true,
      downgraded: [],
    } as { success: true; downgraded: DowngradedUser[] }),
    mockEnqueueFallbackDefaultRecompute: vi.fn().mockResolvedValue({
      success: true,
    } as { success: boolean; error?: string }),
    stableConfig,
  };
});

vi.mock("~/lib/hooks", () => ({
  useFindUniqueAppConfig: () => ({ data: stableConfig }),
  useUpsertAppConfig: () => ({
    mutateAsync: mockUpsertMutateAsync,
    isPending: false,
  }),
}));

vi.mock("~/app/actions/scimMappingActions", () => ({
  previewFallbackDefaultChange: mockPreviewFallbackDefaultChange,
  enqueueFallbackDefaultRecompute: mockEnqueueFallbackDefaultRecompute,
}));

vi.mock("~/lib/scim/access/fallbackDefault", () => ({
  SCIM_DEFAULT_MAPPED_ACCESS_KEY: "scim.defaultMappedAccess",
}));

// We only need the FallbackDefaultCard portion of the page. Import the default export
// which renders the full page inside PaginationProvider. Since we only test FallbackDefaultCard
// behavior, we extract the internal component by mocking the modules it depends on.
// The component is defined inside page.tsx as a module-level function — we test it via
// the page's rendered output (the card is always rendered when the session is ADMIN).

// For isolation we import only the FallbackDefaultCard indirectly through the page;
// because it requires session/pagination we create a thin wrapper that tests the card path.
// Rather than import the page (which needs the full SCIM token hooks), we test the
// FallbackDefaultCard logic by rendering the same component in isolation using its imports.
// Since FallbackDefaultCard is not exported we test it by verifying the data-testids it produces.

// Mock remaining page dependencies so the page renders without errors:
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "admin-1", access: "ADMIN", preferences: {} } },
    status: "authenticated",
  }),
}));

vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("~/lib/contexts/PaginationContext", () => ({
  PaginationProvider: ({ children }: any) => <>{children}</>,
  usePagination: () => ({
    currentPage: 1,
    setCurrentPage: vi.fn(),
    pageSize: 25,
    setPageSize: vi.fn(),
    totalItems: 0,
    setTotalItems: vi.fn(),
    startIndex: 0,
    endIndex: 0,
    totalPages: 1,
  }),
}));

vi.mock("~/hooks/usePageSizeOptions", () => ({
  usePageSizeOptions: () => [25, 50, 100],
}));

vi.mock("@/components/Debounce", () => ({
  useDebounce: (v: string) => v,
}));

vi.mock("@/components/tables/ColumnSelection", () => ({
  ColumnSelection: () => null,
}));

vi.mock("@/components/tables/DataTable", () => ({
  DataTable: () => null,
}));

vi.mock("@/components/tables/Filter", () => ({
  Filter: () => null,
}));

vi.mock("@/components/tables/Pagination", () => ({
  PaginationComponent: () => null,
}));

vi.mock("@/components/tables/PaginationControls", () => ({
  PaginationInfo: () => null,
}));

vi.mock("~/app/actions/scimTokenActions", () => ({
  revokeScimTokenAction: vi.fn(),
}));

vi.mock("./columns", () => ({
  useColumns: () => [],
}));

vi.mock("./ConflictLogTable", () => ({
  ConflictLogTable: () => null,
}));

vi.mock("./MintDialog", () => ({
  MintDialog: () => null,
}));

// Additional hooks used by SCIM token list
vi.mock("~/lib/hooks", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    useFindManyScimToken: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
    useUpdateScimToken: () => ({ mutateAsync: vi.fn() }),
    useFindUniqueAppConfig: () => ({ data: stableConfig }),
    useUpsertAppConfig: () => ({
      mutateAsync: mockUpsertMutateAsync,
      isPending: false,
    }),
  };
});

import ScimTokensPage from "./page";

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

const renderPage = () => {
  const queryClient = makeQueryClient();
  return {
    user: userEvent.setup(),
    ...render(
      <QueryClientProvider client={queryClient}>
        <ScimTokensPage />
      </QueryClientProvider>
    ),
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPreviewFallbackDefaultChange.mockResolvedValue({
    success: true,
    downgraded: [],
  } as { success: true; downgraded: DowngradedUser[] });
  mockEnqueueFallbackDefaultRecompute.mockResolvedValue({
    success: true,
  } as { success: boolean; error?: string });
  mockUpsertMutateAsync.mockResolvedValue(stableConfig);
});

describe("FallbackDefaultCard", () => {
  test("Select initializes from the persisted config value", async () => {
    renderPage();
    await waitFor(() => {
      const select = screen.getByTestId("fallback-default-select");
      expect(select).toBeInTheDocument();
      expect((select as HTMLSelectElement).value).toBe("USER");
    });
  });

  test("Save when previewFallbackDefaultChange returns downgrades opens the AlertDialog and does NOT upsert", async () => {
    mockPreviewFallbackDefaultChange.mockResolvedValueOnce({
      success: true,
      downgraded: [
        {
          userId: "u1",
          name: "User One",
          currentAccess: "ADMIN",
          newAccess: "USER",
        },
      ],
    } as { success: true; downgraded: DowngradedUser[] });

    const { user } = renderPage();

    const saveBtn = await screen.findByTestId("fallback-default-save");
    await user.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    });
    expect(mockUpsertMutateAsync).not.toHaveBeenCalled();
  });

  test("Apply-anyway calls mutateAsync (upsert) AND enqueueFallbackDefaultRecompute after confirming the dialog", async () => {
    mockPreviewFallbackDefaultChange.mockResolvedValueOnce({
      success: true,
      downgraded: [
        {
          userId: "u1",
          name: "User One",
          currentAccess: "ADMIN",
          newAccess: "USER",
        },
      ],
    } as { success: true; downgraded: DowngradedUser[] });

    const { user } = renderPage();

    const saveBtn = await screen.findByTestId("fallback-default-save");
    await user.click(saveBtn);

    // Dialog open — click Apply anyway
    await waitFor(() => {
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    });

    const applyBtn = screen.getByRole("button", {
      name: /admin\.groups\.downgradeConfirmApplyAnyway/i,
    });
    await user.click(applyBtn);

    await waitFor(() => {
      expect(mockUpsertMutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(mockEnqueueFallbackDefaultRecompute).toHaveBeenCalledTimes(1);
    // Assert order: upsert first, then enqueue
    const upsertOrder = mockUpsertMutateAsync.mock.invocationCallOrder[0];
    const enqueueOrder =
      mockEnqueueFallbackDefaultRecompute.mock.invocationCallOrder[0];
    expect(upsertOrder).toBeLessThan(enqueueOrder);
  });

  test("Save when no downgrades upserts and enqueues without opening the dialog", async () => {
    mockPreviewFallbackDefaultChange.mockResolvedValueOnce({
      success: true,
      downgraded: [],
    } as { success: true; downgraded: DowngradedUser[] });

    const { user } = renderPage();

    const saveBtn = await screen.findByTestId("fallback-default-save");
    await user.click(saveBtn);

    await waitFor(() => {
      expect(mockUpsertMutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(mockEnqueueFallbackDefaultRecompute).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
