import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  QaseAnalysis,
  QaseMappingConfiguration,
} from "~/services/imports/qase/mapping";

const apiFetch = vi.hoisted(() => vi.fn());

vi.mock("~/lib/basePath", () => ({ apiFetch }));
vi.mock("next-intl", () => ({
  useTranslations:
    (namespace?: string) => (key: string, values?: Record<string, unknown>) =>
      `${namespace ? `${namespace}.` : ""}${key}${
        values ? ` ${JSON.stringify(values)}` : ""
      }`,
}));
// Radix Select needs pointer capture, which jsdom lacks.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: React.ReactNode;
  }) => (
    <select
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  SelectItem: ({ value }: { value: string }) => (
    <option value={value}>{value}</option>
  ),
}));
// The combobox loads its options on open; a plain select shows the same
// options and the same choice.
vi.mock("@/components/ui/async-combobox", async () => {
  const React = await import("react");
  return {
    AsyncCombobox: ({
      value,
      onValueChange,
      fetchOptions,
      getOptionValue,
      ariaLabel,
    }: {
      value: unknown;
      onValueChange: (value: unknown) => void;
      fetchOptions: (query: string) => Promise<unknown[]>;
      getOptionValue: (option: unknown) => string | number;
      ariaLabel: string;
    }) => {
      const [options, setOptions] = React.useState<unknown[]>([]);
      React.useEffect(() => {
        void fetchOptions("").then(setOptions);
      }, [fetchOptions]);
      return (
        <select
          aria-label={ariaLabel}
          value={value ? String(getOptionValue(value)) : ""}
          onChange={(event) =>
            onValueChange(
              options.find(
                (option) =>
                  String(getOptionValue(option)) === event.target.value
              ) ?? null
            )
          }
        >
          <option value="" />
          {options.map((option) => (
            <option
              key={String(getOptionValue(option))}
              value={String(getOptionValue(option))}
            >
              {String(getOptionValue(option))}
            </option>
          ))}
        </select>
      );
    },
  };
});

import { QaseMappingStep } from "./QaseMappingStep";

const ok = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

const analysis = (overrides: Partial<QaseAnalysis> = {}): QaseAnalysis => ({
  source: {
    projects: [
      {
        code: "SHOP",
        title: "Shop",
        cases: 2,
        suites: 1,
        milestones: 0,
        runs: 0,
        defects: 0,
      },
    ],
    users: [],
    caseStatuses: [{ id: "0", title: "Actual" }],
    fields: [
      {
        key: "system:type",
        title: "Type",
        targetType: "Dropdown",
        options: [
          { id: "1", title: "Smoke" },
          { id: "2", title: "Functional" },
        ],
      },
    ],
  },
  existing: {
    projects: [{ id: 7, name: "Web shop" }],
    users: [],
    workflows: [
      {
        id: 3,
        name: "Active",
        isDefault: true,
        icon: { name: "circle" },
        color: { value: "#000000" },
      },
    ],
    templates: [],
    caseFields: [
      {
        id: 11,
        displayName: "Type",
        systemName: "type",
        type: "Dropdown",
        options: [{ id: 21, name: "Functional" }],
      },
      {
        id: 12,
        displayName: "Notes",
        systemName: "notes",
        type: "Text Long",
        options: [],
      },
    ],
  },
  storageConfigured: true,
  ...overrides,
});

const configuration = (): QaseMappingConfiguration => ({
  projects: { SHOP: { mappedTo: null } },
  users: {},
  caseStatuses: { "0": { mappedTo: 3 } },
  template: { action: "create", mappedTo: null, name: "Qase" },
  fields: { "system:type": { action: "map", mappedTo: 11, name: "" } },
});

function mount(
  loaded: { analysis: QaseAnalysis; configuration: QaseMappingConfiguration },
  responses: Record<string, Response> = {}
) {
  apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET") {
      return ok({ ...loaded, problems: [] });
    }
    return (
      responses[`${method} ${url}`] ??
      ok(method === "PUT" ? {} : { job: { id: "job-1", status: "QUEUED" } })
    );
  });
  const onStarted = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <QaseMappingStep jobId="job-1" onStarted={onStarted} />
    </QueryClientProvider>
  );
  return { onStarted };
}

const calls = (method: string) =>
  apiFetch.mock.calls.filter(([, init]) => (init?.method ?? "GET") === method);

describe("QaseMappingStep", () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it("blocks the import until every project has a destination", async () => {
    mount({ analysis: analysis(), configuration: configuration() });

    const start = await screen.findByTestId("qase-start-import-button");
    expect(start).toBeDisabled();
    expect(screen.getByTestId("qase-mapping-problems")).toBeInTheDocument();

    const project = within(
      screen.getByTestId("qase-map-project-SHOP")
    ).getByRole("combobox");
    await waitFor(() =>
      expect(within(project).getAllByRole("option")).toHaveLength(2)
    );
    await userEvent.selectOptions(project, "7");

    expect(start).toBeEnabled();
    expect(screen.queryByTestId("qase-mapping-problems")).toBeNull();
  });

  it("saves the mapping, then starts the import", async () => {
    const loaded = configuration();
    loaded.projects.SHOP.mappedTo = 7;
    const { onStarted } = mount({
      analysis: analysis(),
      configuration: loaded,
    });

    await userEvent.click(
      await screen.findByTestId("qase-start-import-button")
    );

    await waitFor(() => expect(onStarted).toHaveBeenCalledTimes(1));
    expect(onStarted).toHaveBeenCalledWith({ id: "job-1", status: "QUEUED" });
    const [putUrl, putInit] = calls("PUT")[0];
    expect(putUrl).toBe("/api/imports/qase/jobs/job-1/mapping");
    expect(JSON.parse(String(putInit.body))).toEqual({ configuration: loaded });
    expect(calls("POST")[0][0]).toBe("/api/imports/qase/jobs/job-1/import");
    expect(apiFetch.mock.calls.findIndex(([, i]) => i?.method === "PUT")).toBe(
      apiFetch.mock.calls.findIndex(([, i]) => i?.method === "POST") - 1
    );
  });

  it("does not start the import when the mapping cannot be saved", async () => {
    const loaded = configuration();
    loaded.projects.SHOP.mappedTo = 7;
    const { onStarted } = mount(
      { analysis: analysis(), configuration: loaded },
      { "PUT /api/imports/qase/jobs/job-1/mapping": ok({}, 500) }
    );

    await userEvent.click(
      await screen.findByTestId("qase-start-import-button")
    );

    expect(await screen.findByTestId("qase-mapping-error")).toBeInTheDocument();
    expect(calls("POST")).toHaveLength(0);
    expect(onStarted).not.toHaveBeenCalled();
  });

  it("shows an error when the import is refused", async () => {
    const loaded = configuration();
    loaded.projects.SHOP.mappedTo = 7;
    const { onStarted } = mount(
      { analysis: analysis(), configuration: loaded },
      { "POST /api/imports/qase/jobs/job-1/import": ok({}, 400) }
    );

    await userEvent.click(
      await screen.findByTestId("qase-start-import-button")
    );

    expect(await screen.findByTestId("qase-mapping-error")).toBeInTheDocument();
    expect(onStarted).not.toHaveBeenCalled();
  });

  it("names the Qase options an existing field does not have", async () => {
    mount({ analysis: analysis(), configuration: configuration() });

    const row = await screen.findByTestId("qase-map-field-system:type");

    expect(row).toHaveTextContent("fieldUnmatchedOptions");
    expect(row).toHaveTextContent("Smoke");
    expect(row).not.toHaveTextContent("Functional");
  });

  it("offers only existing fields of the same type", async () => {
    mount({ analysis: analysis(), configuration: configuration() });

    const target = within(
      await screen.findByTestId("qase-map-field-target-system:type")
    ).getByRole("combobox");

    await waitFor(() =>
      expect(
        within(target)
          .getAllByRole("option")
          .map((option) => (option as HTMLOptionElement).value)
      ).toEqual(["", "11"])
    );
  });

  it("asks for a name when a field is switched to a new one", async () => {
    const loaded = configuration();
    loaded.projects.SHOP.mappedTo = 7;
    mount({ analysis: analysis(), configuration: loaded });

    const row = await screen.findByTestId("qase-map-field-system:type");
    await userEvent.selectOptions(
      within(row).getAllByRole("combobox")[0],
      "create"
    );

    // "Type" is taken by the existing field, so the import stays blocked
    // until the new field gets another name.
    const name = within(row).getByRole("textbox");
    expect(name).toHaveValue("Type");
    expect(screen.getByTestId("qase-start-import-button")).toBeDisabled();

    await userEvent.type(name, " (Qase)");

    expect(screen.getByTestId("qase-start-import-button")).toBeEnabled();
  });

  it("warns when attachments cannot be copied", async () => {
    mount({
      analysis: analysis({ storageConfigured: false }),
      configuration: configuration(),
    });

    expect(
      await screen.findByTestId("qase-mapping-no-storage")
    ).toBeInTheDocument();
  });

  it("says so when the mapping cannot be loaded", async () => {
    apiFetch.mockResolvedValue(ok({}, 500));
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <QaseMappingStep jobId="job-1" onStarted={vi.fn()} />
      </QueryClientProvider>
    );

    expect(
      await screen.findByText("admin.imports.qase.mapping.loadFailed")
    ).toBeInTheDocument();
  });
});
