import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// next-intl: return the key with simple {param} interpolation so test
// IDs and value assertions stay stable.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) => {
    let value = key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        value = value.replace(`{${k}}`, String(v));
      });
    }
    return value;
  },
}));

// `~/lib/navigation` Link wrapper. The dialog's "Manage shared datasets"
// affordance uses Link; we stub it as an anchor so it renders without
// pulling in the i18n routing chain.
vi.mock("~/lib/navigation", () => ({
  Link: ({
    children,
    href,
    onClick,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    onClick?: () => void;
  }) => (
    <a href={href} onClick={onClick} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

// Hoisted mocks for the ZenStack hooks the dialog uses. Each hook is a
// `vi.fn()` so individual tests can stub their return.
const hooks = vi.hoisted(() => ({
  useFindManyDataSet: vi.fn(),
  useFindFirstDataSetVersion: vi.fn(),
  useFindManyTestCaseParameter: vi.fn(),
  // Used by the embedded SharedDatasetVersionPicker.
  useFindManyDataSetVersion: vi.fn(),
}));

vi.mock("~/lib/hooks", () => ({
  useFindManyDataSet: hooks.useFindManyDataSet,
  useFindFirstDataSetVersion: hooks.useFindFirstDataSetVersion,
  useFindManyTestCaseParameter: hooks.useFindManyTestCaseParameter,
  useFindManyDataSetVersion: hooks.useFindManyDataSetVersion,
}));

// Sonner toast — track calls but don't render anything.
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: any[]) => toastSuccess(...args),
    error: vi.fn(),
    message: vi.fn(),
  },
}));

import { AssignSharedDatasetDialog } from "@/components/parameters/AssignSharedDatasetDialog";

const wrap = (children: React.ReactNode) => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

const baseDataset = { id: 7, name: "Test users" };
const baseVersion = {
  id: 50,
  version: 2,
  parametersJson: [{ name: "email" }, { name: "password" }],
  rowsJson: [],
};

const baseParameters = [
  { name: "email", required: true },
  { name: "password", required: true },
];

const defaultStubs = () => {
  hooks.useFindManyDataSet.mockReturnValue({
    data: [baseDataset],
    isLoading: false,
  });
  hooks.useFindFirstDataSetVersion.mockReturnValue({ data: baseVersion });
  hooks.useFindManyTestCaseParameter.mockReturnValue({
    data: baseParameters,
  });
  // SharedDatasetVersionPicker queries the historical-versions list.
  hooks.useFindManyDataSetVersion.mockReturnValue({
    data: [
      {
        id: 50,
        version: 2,
        rowCount: 0,
        createdAt: new Date("2026-05-02"),
        createdBy: { name: "Tester" },
      },
      {
        id: 49,
        version: 1,
        rowCount: 0,
        createdAt: new Date("2026-05-01"),
        createdBy: { name: "Tester" },
      },
    ],
    isLoading: false,
  });
};

describe("AssignSharedDatasetDialog", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("renders an empty-state message when no shared datasets exist in the project", () => {
    hooks.useFindManyDataSet.mockReturnValue({ data: [], isLoading: false });
    hooks.useFindFirstDataSetVersion.mockReturnValue({ data: null });
    hooks.useFindManyTestCaseParameter.mockReturnValue({ data: [] });

    render(
      wrap(
        <AssignSharedDatasetDialog
          open={true}
          onOpenChange={() => {}}
          caseId={10}
          projectId={1}
          hasOwnerDataset={false}
        />
      )
    );

    expect(
      screen.getByTestId("assign-shared-dataset-dialog")
    ).toBeInTheDocument();
    // The empty-state copy uses the `assignSharedNoDatasets` key.
    expect(screen.getByText("assignSharedNoDatasets")).toBeInTheDocument();
    // No dataset-select trigger because there's nothing to pick.
    expect(
      screen.queryByTestId("assign-shared-dataset-select")
    ).not.toBeInTheDocument();
  });

  it("renders the dataset selector when shared datasets exist (initially with no selection)", () => {
    defaultStubs();

    render(
      wrap(
        <AssignSharedDatasetDialog
          open={true}
          onOpenChange={() => {}}
          caseId={10}
          projectId={1}
          hasOwnerDataset={false}
        />
      )
    );

    expect(
      screen.getByTestId("assign-shared-dataset-select")
    ).toBeInTheDocument();
    // No dataset selected yet → pin section + mapping section are hidden.
    expect(
      screen.queryByTestId("assign-shared-pin-current")
    ).not.toBeInTheDocument();
  });

  it("when prefilled with a current-version pin, the pin radio is 'current' (RESEARCH.md Pitfall 5 default)", () => {
    defaultStubs();

    render(
      wrap(
        <AssignSharedDatasetDialog
          open={true}
          onOpenChange={() => {}}
          caseId={10}
          projectId={1}
          hasOwnerDataset={false}
          currentAssignment={{
            sharedDataSetId: 7,
            pinnedVersionId: 50, // pinned to current version → mode is "current" or "specific"
            mappingJson: { email: "email", password: "password" },
          }}
        />
      )
    );

    // With a dataset prefilled, the pin section renders; default for a
    // brand-new (no currentAssignment) flow is "current". For a prefilled
    // assignment with a pinned version, the dialog uses "specific" mode
    // and shows the picker. Either way, the three radios are present.
    expect(screen.getByTestId("assign-shared-pin-current")).toBeInTheDocument();
    expect(
      screen.getByTestId("assign-shared-pin-follow-latest")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("assign-shared-pin-specific")
    ).toBeInTheDocument();
  });

  it("Pin to a specific version renders the SharedDatasetVersionPicker in mode=picker (W4 — no 'current' item)", async () => {
    defaultStubs();

    render(
      wrap(
        <AssignSharedDatasetDialog
          open={true}
          onOpenChange={() => {}}
          caseId={10}
          projectId={1}
          hasOwnerDataset={false}
          currentAssignment={{
            sharedDataSetId: 7,
            pinnedVersionId: 50,
            mappingJson: { email: "email", password: "password" },
          }}
        />
      )
    );

    // currentAssignment has pinnedVersionId !== null → initial pin mode is
    // "specific", so the picker should render immediately.
    const picker = await screen.findByTestId(
      "assign-shared-pin-specific-picker"
    );
    expect(picker).toBeInTheDocument();

    // The picker itself surfaces its mode through data-mode. W4 lock:
    // mode="picker" means the items list excludes the "current" entry.
    const innerPicker = await screen.findByTestId(
      "shared-dataset-version-picker"
    );
    expect(innerPicker.getAttribute("data-mode")).toBe("picker");
    expect(
      screen.queryByTestId("shared-dataset-version-picker-item-current")
    ).not.toBeInTheDocument();
  });

  it("renders the Amendment-A info banner when hasOwnerDataset is true; Save still works", async () => {
    defaultStubs();
    const onSaved = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ assignment: { id: 1 } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(
      wrap(
        <AssignSharedDatasetDialog
          open={true}
          onOpenChange={() => {}}
          caseId={10}
          projectId={1}
          hasOwnerDataset={true} // Amendment A: owner+shared coexistence
          // Use pinnedVersionId: null → initial pinMode is "follow-latest"
          // so Save can be enabled without picker interaction.
          currentAssignment={{
            sharedDataSetId: 7,
            pinnedVersionId: null,
            mappingJson: { email: "email", password: "password" },
          }}
          onSaved={onSaved}
        />
      )
    );

    expect(
      screen.getByTestId("assign-shared-owner-banner")
    ).toBeInTheDocument();

    // Save should still be wired (mappingValid will flip to true after
    // SharedDatasetMappingFields' onValidityChange effect runs).
    const save = screen.getByTestId("assign-shared-save");
    await waitFor(() => expect(save).toBeEnabled());
    save.click();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const callArgs = fetchMock.mock.calls[0];
    expect(callArgs[0]).toBe(`/api/repository/cases/10/shared-dataset`);
    expect(callArgs[1].method).toBe("PUT");
    const body = JSON.parse(callArgs[1].body);
    expect(body.sharedDataSetId).toBe(7);
    // follow-latest → pinnedVersionId is null on the wire.
    expect(body.pinnedVersionId).toBeNull();
    expect(body.mappingJson).toEqual({
      email: "email",
      password: "password",
    });
  });

  it("Save with a fully valid mapping POSTs the expected body and calls onSaved", async () => {
    defaultStubs();
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ assignment: { id: 1 } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(
      wrap(
        <AssignSharedDatasetDialog
          open={true}
          onOpenChange={onOpenChange}
          caseId={10}
          projectId={1}
          hasOwnerDataset={false}
          // Use follow-latest (null pin) so Save is reachable without
          // picker interaction.
          currentAssignment={{
            sharedDataSetId: 7,
            pinnedVersionId: null,
            mappingJson: { email: "email", password: "password" },
          }}
          onSaved={onSaved}
        />
      )
    );

    const save = screen.getByTestId("assign-shared-save");
    await waitFor(() => expect(save).toBeEnabled());
    save.click();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Save remains disabled when no dataset is selected", () => {
    defaultStubs();

    render(
      wrap(
        <AssignSharedDatasetDialog
          open={true}
          onOpenChange={() => {}}
          caseId={10}
          projectId={1}
          hasOwnerDataset={false}
        />
      )
    );

    const save = screen.getByTestId("assign-shared-save");
    expect(save).toBeDisabled();
  });

  it("Save remains disabled when a required parameter is unmapped", () => {
    defaultStubs();
    // Two required params on the case, but mapping only covers one →
    // mappingValid stays false → Save disabled.
    hooks.useFindManyTestCaseParameter.mockReturnValue({
      data: [
        { name: "email", required: true },
        { name: "password", required: true },
      ],
    });

    render(
      wrap(
        <AssignSharedDatasetDialog
          open={true}
          onOpenChange={() => {}}
          caseId={10}
          projectId={1}
          hasOwnerDataset={false}
          currentAssignment={{
            sharedDataSetId: 7,
            pinnedVersionId: 50,
            // Only email mapped; password (required) is NOT mapped.
            mappingJson: { email: "email" },
          }}
        />
      )
    );

    const save = screen.getByTestId("assign-shared-save");
    expect(save).toBeDisabled();

    // The required-unmapped alert should be visible.
    expect(
      screen.getByTestId("shared-mapping-required-alert")
    ).toBeInTheDocument();
  });
});
