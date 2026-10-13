import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImportCasesWizard } from "./ImportCasesWizard";

// Applying a saved column mapping from the mapping page: the saved template
// and parse settings are restored, the file is re-read when those settings
// change its columns, and columns the mapping doesn't name keep their
// auto-match.

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  savedProps: null as any,
  toApply: null as unknown,
  result: undefined as unknown,
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "1" }),
}));

vi.mock("next-intl", () => {
  const t = (key: string) => key;
  return {
    useTranslations: () => Object.assign(t, { rich: t }),
  };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const templates = [
  {
    id: 1,
    templateName: "Basic",
    isDefault: true,
    caseFields: [
      {
        caseField: {
          systemName: "priority",
          displayName: "Priority",
          isRequired: false,
          type: { type: "Dropdown" },
        },
      },
    ],
  },
  {
    id: 2,
    templateName: "Severity",
    isDefault: false,
    caseFields: [
      {
        caseField: {
          systemName: "severity",
          displayName: "Severity",
          isRequired: false,
          type: { type: "Dropdown" },
        },
      },
    ],
  },
];

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    templates: { useFindMany: () => ({ data: templates }) },
    repositoryFolders: { useFindMany: () => ({ data: [] }) },
    projectLlmIntegration: { useFindMany: () => ({ data: [] }) },
  }),
}));

vi.mock("papaparse", () => ({ default: { parse: mocks.parse } }));

vi.mock("@/components/UploadAttachments", () => ({
  default: ({ onFileSelect }: { onFileSelect: (files: File[]) => void }) => (
    <input
      type="file"
      title="file-upload"
      data-testid="file-upload"
      onChange={(e) => onFileSelect(Array.from(e.target.files ?? []))}
    />
  ),
}));

vi.mock("@/components/forms/FolderSelect", () => ({
  FolderSelect: ({ onChange }: { onChange: (value: string) => void }) => (
    <button
      type="button"
      data-testid="pick-folder"
      onClick={() => onChange("10")}
    />
  ),
  transformFolders: (folders: unknown[]) => folders,
}));

// Stands in for the saved-mappings menu: records what the wizard passes and
// applies `mocks.toApply` through its onApply.
vi.mock("@/components/import/SavedImportMappings", () => ({
  SavedImportMappings: (props: any) => {
    mocks.savedProps = props;
    return (
      <button
        type="button"
        data-testid="apply-saved-mapping"
        onClick={async () => {
          mocks.result = await props.onApply(mocks.toApply);
        }}
      />
    );
  },
  SaveImportMappingPrompt: () => null,
}));

const saved = (
  columns: Array<[string, string | null]>,
  settings: Record<string, unknown> = {},
  templateId: number | null = 1
) => ({
  id: "m1",
  name: "Weekly export",
  templateId,
  config: {
    version: 1,
    columns: columns.map(([column, field]) => ({ column, field })),
    settings,
  },
});

/** Headers the mocked parser returns for each delimiter. */
function parseWith(headersByDelimiter: Record<string, string[]>) {
  mocks.parse.mockImplementation((_text, options) =>
    options.complete({
      data: [],
      meta: { fields: headersByDelimiter[options.delimiter] ?? [] },
      errors: [],
    })
  );
}

async function openMappingPage() {
  render(<ImportCasesWizard open onClose={vi.fn()} />);
  fireEvent.change(screen.getByTestId("file-upload"), {
    target: { files: [new File(["x"], "cases.csv", { type: "text/csv" })] },
  });
  fireEvent.click(screen.getByTestId("pick-folder"));
  fireEvent.click(screen.getByTestId("next-button"));
  await screen.findByTestId("apply-saved-mapping");
  await waitFor(() =>
    expect(mocks.savedProps.current.columns.length).toBeGreaterThan(0)
  );
}

async function apply() {
  fireEvent.click(screen.getByTestId("apply-saved-mapping"));
  await waitFor(() => expect(mocks.result).toBeDefined());
}

const currentColumns = () => mocks.savedProps.current.columns;

describe("ImportCasesWizard — applying a saved mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.savedProps = null;
    mocks.result = undefined;
  });

  it("maps saved columns and keeps the auto-match on the rest", async () => {
    parseWith({ ",": ["Title", "Prio", "Owner"] });
    mocks.toApply = saved([
      ["Prio", "priority"],
      ["Owner", "tags"],
      ["Area", "estimate"],
    ]);
    await openMappingPage();

    await apply();

    expect(currentColumns()).toEqual([
      { column: "Title", field: "name" },
      { column: "Prio", field: "priority" },
      { column: "Owner", field: "tags" },
    ]);
    expect(mocks.result).toMatchObject({
      missingColumns: ["Area"],
      unavailableFields: [],
    });
    expect(mocks.parse).toHaveBeenCalledTimes(1);
  });

  it("re-reads the file when the saved delimiter differs", async () => {
    parseWith({
      ",": ["Title;Prio"],
      ";": ["Title", "Prio"],
    });
    mocks.toApply = saved([["Prio", "priority"]], { delimiter: ";" });
    await openMappingPage();
    expect(currentColumns()).toHaveLength(1);

    await apply();

    expect(mocks.parse).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ delimiter: ";" })
    );
    expect(currentColumns()).toEqual([
      { column: "Title", field: "name" },
      { column: "Prio", field: "priority" },
    ]);
    expect(mocks.savedProps.current.settings).toMatchObject({
      delimiter: ";",
    });
  });

  it("switches to the saved template and skips fields it lacks", async () => {
    parseWith({ ",": ["Title", "Prio", "Sev"] });
    mocks.toApply = saved(
      [
        ["Prio", "priority"],
        ["Sev", "severity"],
      ],
      {},
      2
    );
    await openMappingPage();
    expect(mocks.savedProps.templateId).toBe(1);

    await apply();

    await waitFor(() => expect(mocks.savedProps.templateId).toBe(2));
    expect(currentColumns()).toContainEqual({
      column: "Sev",
      field: "severity",
    });
    expect(currentColumns()).toContainEqual({ column: "Prio", field: null });
    expect(mocks.result).toMatchObject({
      unavailableFields: [{ column: "Prio", field: "priority" }],
    });
  });

  it("keeps the current template when the saved one isn't available", async () => {
    parseWith({ ",": ["Title", "Prio"] });
    mocks.toApply = saved([["Prio", "priority"]], {}, 99);
    await openMappingPage();

    await apply();

    expect(mocks.savedProps.templateId).toBe(1);
    expect(currentColumns()).toContainEqual({
      column: "Prio",
      field: "priority",
    });
  });

  it("restores the saved row mode", async () => {
    parseWith({ ",": ["Title", "Step"] });
    mocks.toApply = saved([["Step", "steps"]], { rowMode: "multi" });
    await openMappingPage();
    expect(mocks.savedProps.current.settings.rowMode).toBe("single");

    await apply();

    await waitFor(() =>
      expect(mocks.savedProps.current.settings.rowMode).toBe("multi")
    );
  });
});
