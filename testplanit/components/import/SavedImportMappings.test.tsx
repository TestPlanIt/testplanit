import { beforeEach, describe, expect, it, vi } from "vitest";

import { fireEvent, render, screen, waitFor, within } from "~/test/test-utils";

import {
  SavedImportMappings,
  SaveImportMappingPrompt,
} from "./SavedImportMappings";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMapping: vi.fn(),
  createMapping: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  session: { user: { id: "user-1", access: "USER" } } as any,
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    importMapping: {
      useFindMany: (...args: unknown[]) => mocks.findMany(...args),
      useUpdate: () => ({
        mutateAsync: mocks.updateMapping,
        isPending: false,
      }),
      useCreate: () => ({
        mutateAsync: mocks.createMapping,
        isPending: false,
      }),
    },
  }),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: mocks.session }),
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

vi.mock("next-intl", async () => {
  const messages = (await import("../../messages/en-US.json")).default;
  const get = (k: string) =>
    k
      .split(".")
      .reduce<any>((acc, part) => (acc ? acc[part] : undefined), messages);
  const translate =
    (namespace?: string) => (key: string, params?: Record<string, unknown>) => {
      let msg = get(namespace ? `${namespace}.${key}` : key);
      if (typeof msg !== "string") return key;
      if (params) {
        for (const [p, v] of Object.entries(params)) {
          if (typeof v !== "function")
            msg = msg.split(`{${p}}`).join(String(v));
        }
      }
      return msg.replace(/<\/?\w+>/g, "");
    };
  return {
    useTranslations: (namespace?: string) =>
      Object.assign(translate(namespace), { rich: translate(namespace) }),
  };
});

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

const config = (columns: Array<[string, string | null]>) => ({
  version: 1,
  columns: columns.map(([column, field]) => ({ column, field })),
  settings: { delimiter: ",", hasHeaders: true },
});

const privateMapping = {
  id: "m-private",
  name: "Regression sheet",
  description: null,
  config: config([
    ["Title", "name"],
    ["Steps", "steps"],
  ]),
  templateId: 5,
  isShared: false,
  createdById: "user-1",
  createdBy: { name: "Me" },
  template: { templateName: "Default" },
};

const sharedByOther = {
  id: "m-shared",
  name: "TestRail export",
  description: "From the weekly export",
  config: config([["Summary", "name"]]),
  templateId: null,
  isShared: true,
  createdById: "user-2",
  createdBy: { name: "Alex" },
  template: null,
};

function mockMappings(items: unknown[]) {
  mocks.findMany.mockReturnValue({ data: items, isLoading: false });
}

/** The page's mapping before a saved one is applied: Steps still unmapped. */
const unappliedCurrent = {
  columns: [
    { column: "Title", field: "name" },
    { column: "Steps", field: null },
  ],
  settings: { delimiter: ",", hasHeaders: true } as const,
};

function renderMappings(
  props: Partial<React.ComponentProps<typeof SavedImportMappings>> = {}
) {
  const onApply = vi.fn().mockReturnValue({
    mappings: [],
    missingColumns: [],
    unavailableFields: [],
  });
  render(
    <SavedImportMappings
      wizard="TEST_CASES"
      projectId={7}
      templateId={5}
      headers={["Title", "Steps"]}
      current={{
        columns: [
          { column: "Title", field: "name" },
          { column: "Steps", field: "steps" },
        ],
        settings: { delimiter: ",", hasHeaders: true },
      }}
      onApply={onApply}
      {...props}
    />
  );
  return { onApply };
}

describe("SavedImportMappings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session = { user: { id: "user-1", access: "USER" } };
    mocks.updateMapping.mockResolvedValue({});
    mocks.createMapping.mockResolvedValue({ id: "new" });
  });

  it("lists the user's own mappings and those others shared for the template", () => {
    mockMappings([privateMapping, sharedByOther]);
    renderMappings({ headers: ["Other"] });

    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          wizard: "TEST_CASES",
          isDeleted: false,
          OR: [
            { createdById: "user-1" },
            {
              isShared: true,
              OR: [
                { templateId: null },
                { template: { projects: { some: { projectId: 7 } } } },
              ],
            },
          ],
        },
      }),
      { enabled: true }
    );
    const list = screen.getByTestId("saved-import-mappings-list");
    expect(within(list).getByText("My mappings")).toBeInTheDocument();
    expect(within(list).getByText("Shared by others")).toBeInTheDocument();
    expect(within(list).getByTitle("Shared by Alex")).toHaveTextContent("Alex");
    expect(within(list).getByText("Default")).toBeInTheDocument();
  });

  it("lists every shared mapping for wizards without templates", () => {
    mockMappings([]);
    renderMappings({ wizard: "SHARED_STEPS", templateId: null });

    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          wizard: "SHARED_STEPS",
          isDeleted: false,
          OR: [{ createdById: "user-1" }, { isShared: true }],
        },
      }),
      { enabled: true }
    );
  });

  it("marks the user's own shared mappings", () => {
    mockMappings([{ ...privateMapping, isShared: true }]);
    renderMappings({ headers: ["Other"] });

    const list = screen.getByTestId("saved-import-mappings-list");
    expect(within(list).getByText("My mappings")).toBeInTheDocument();
    expect(
      within(list).getByTestId("saved-import-mapping-shared")
    ).toHaveAttribute("title", "Shared");
  });

  it("suggests a saved mapping whose columns match the file", () => {
    mockMappings([privateMapping, sharedByOther]);
    renderMappings({ current: unappliedCurrent });

    expect(
      screen.getByTestId("saved-import-mapping-suggestion")
    ).toHaveTextContent("Regression sheet");
  });

  it("does not suggest a mapping the page already matches", () => {
    mockMappings([
      {
        ...privateMapping,
        config: {
          version: 1,
          columns: [
            { column: "Title", field: "name" },
            { column: "Steps", field: "steps" },
          ],
          settings: { delimiter: ",", hasHeaders: true },
        },
      },
    ]);
    renderMappings();

    expect(
      screen.queryByTestId("saved-import-mapping-suggestion")
    ).not.toBeInTheDocument();
  });

  it("does not suggest a mapping when a saved column is missing", () => {
    mockMappings([sharedByOther]);
    renderMappings();

    expect(
      screen.queryByTestId("saved-import-mapping-suggestion")
    ).not.toBeInTheDocument();
  });

  it("applies a mapping and lists what was skipped", async () => {
    mockMappings([privateMapping]);
    const { onApply } = renderMappings({ current: unappliedCurrent });
    onApply.mockResolvedValue({
      mappings: [],
      missingColumns: ["Priority"],
      unavailableFields: [{ column: "Severity", field: "severity" }],
    });

    fireEvent.click(
      screen.getByTestId("saved-import-mapping-suggestion-apply")
    );

    await waitFor(() =>
      expect(screen.getByTestId("saved-import-mapping-skipped")).toBeVisible()
    );
    expect(onApply).toHaveBeenCalledWith({
      id: "m-private",
      name: "Regression sheet",
      templateId: 5,
      config: privateMapping.config,
    });
    const notice = screen.getByTestId("saved-import-mapping-skipped");
    expect(notice).toHaveTextContent("Not in the uploaded file: Priority");
    expect(notice).toHaveTextContent("Severity");
    expect(
      screen.queryByTestId("saved-import-mapping-suggestion")
    ).not.toBeInTheDocument();
  });

  it("refuses to apply a corrupt mapping", () => {
    mockMappings([{ ...privateMapping, config: { version: 9 } }]);
    const { onApply } = renderMappings({ headers: ["Other"] });

    fireEvent.click(screen.getByTestId("saved-import-mapping-item"));

    expect(onApply).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith(
      "This saved mapping is no longer valid."
    );
  });

  it("hides manage actions on another user's shared mapping", () => {
    mockMappings([sharedByOther]);
    renderMappings({ headers: ["Other"] });

    expect(
      screen.queryByTestId("saved-import-mapping-delete")
    ).not.toBeInTheDocument();
  });

  it("lets a system admin manage another user's shared mapping", () => {
    mocks.session = { user: { id: "user-1", access: "ADMIN" } };
    mockMappings([sharedByOther]);
    renderMappings({ headers: ["Other"] });

    expect(screen.getByTestId("saved-import-mapping-delete")).toBeVisible();
  });

  it("soft-deletes a mapping", async () => {
    mockMappings([privateMapping]);
    renderMappings({ headers: ["Other"] });

    fireEvent.click(screen.getByTestId("saved-import-mapping-delete"));
    fireEvent.click(
      await screen.findByTestId("saved-import-mapping-delete-confirm")
    );

    await waitFor(() =>
      expect(mocks.updateMapping).toHaveBeenCalledWith({
        where: { id: "m-private" },
        data: { isDeleted: true, deletedAt: expect.any(Date) },
      })
    );
  });

  it("updates a mapping with the current columns and template", async () => {
    mockMappings([privateMapping]);
    renderMappings({ headers: ["Other"], templateId: 9 });

    fireEvent.click(screen.getByTestId("saved-import-mapping-update"));
    fireEvent.click(
      await screen.findByTestId("saved-import-mapping-update-confirm")
    );

    await waitFor(() =>
      expect(mocks.updateMapping).toHaveBeenCalledWith({
        where: { id: "m-private" },
        data: {
          config: {
            version: 1,
            columns: [
              { column: "Title", field: "name" },
              { column: "Steps", field: "steps" },
            ],
            settings: { delimiter: ",", hasHeaders: true },
          },
          templateId: 9,
        },
      })
    );
  });

  it("saves a shared mapping", async () => {
    mockMappings([]);
    renderMappings();

    fireEvent.click(screen.getByTestId("save-import-mapping-button"));
    fireEvent.change(await screen.findByTestId("import-mapping-name-input"), {
      target: { value: "  Weekly export  " },
    });
    fireEvent.click(screen.getByTestId("import-mapping-share-checkbox"));
    fireEvent.click(screen.getByTestId("import-mapping-save-button"));

    await waitFor(() =>
      expect(mocks.createMapping).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: "Weekly export",
          description: null,
          wizard: "TEST_CASES",
          templateId: 5,
          isShared: true,
          createdById: "user-1",
        }),
      })
    );
  });

  it("saves a private mapping by default", async () => {
    mockMappings([]);
    renderMappings();

    fireEvent.click(screen.getByTestId("save-import-mapping-button"));
    fireEvent.change(await screen.findByTestId("import-mapping-name-input"), {
      target: { value: "Mine" },
    });
    fireEvent.click(screen.getByTestId("import-mapping-save-button"));

    await waitFor(() =>
      expect(mocks.createMapping).toHaveBeenCalledWith({
        data: expect.objectContaining({ isShared: false }),
      })
    );
  });
});

describe("SaveImportMappingPrompt", () => {
  const current = {
    columns: [
      { column: "Title", field: "name" },
      { column: "Steps", field: "steps" },
    ],
    settings: { delimiter: ",", hasHeaders: true } as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session = { user: { id: "user-1", access: "USER" } };
    mocks.createMapping.mockResolvedValue({ id: "new" });
  });

  it("offers to save a mapping that isn't saved yet", async () => {
    mockMappings([sharedByOther]);
    render(
      <SaveImportMappingPrompt
        wizard="TEST_CASES"
        projectId={7}
        templateId={5}
        current={current}
      />
    );

    fireEvent.click(screen.getByTestId("save-import-mapping-prompt-button"));
    fireEvent.change(await screen.findByTestId("import-mapping-name-input"), {
      target: { value: "Regression" },
    });
    fireEvent.click(screen.getByTestId("import-mapping-save-button"));

    await waitFor(() =>
      expect(mocks.createMapping).toHaveBeenCalledWith({
        data: expect.objectContaining({ name: "Regression", templateId: 5 }),
      })
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId("save-import-mapping-prompt")
      ).not.toBeInTheDocument()
    );
  });

  it("stays hidden when a saved mapping already matches", () => {
    mockMappings([privateMapping]);
    render(
      <SaveImportMappingPrompt
        wizard="TEST_CASES"
        projectId={7}
        current={current}
      />
    );

    expect(
      screen.queryByTestId("save-import-mapping-prompt")
    ).not.toBeInTheDocument();
  });
});
