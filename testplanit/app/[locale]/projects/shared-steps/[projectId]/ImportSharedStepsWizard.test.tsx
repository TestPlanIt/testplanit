import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImportSharedStepsWizard } from "./ImportSharedStepsWizard";

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  savedProps: null as any,
  toApply: null as unknown,
  result: undefined as unknown,
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "1" }),
}));

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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

// Render each column's Select as a native select so a test can change it.
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
      data-testid="column-select"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  SelectItem: ({
    value,
    children,
  }: {
    value: string;
    children: React.ReactNode;
  }) => <option value={value}>{children}</option>,
}));

vi.mock("@/components/ui/separator", () => ({ Separator: () => null }));

const COLUMNS = ["Group", "Combined Step Data", "Steps Data", "Notes"];

describe("ImportSharedStepsWizard", () => {
  beforeEach(() => {
    mocks.parse.mockReset();
    mocks.parse.mockImplementation((_text, options) =>
      options.complete({
        data: [
          {
            Group: "Login",
            "Combined Step Data": "1. Open",
            "Steps Data": "[]",
            Notes: "n",
          },
        ],
        meta: { fields: COLUMNS },
        errors: [],
      })
    );
  });

  it("keeps the column mapping when returning from the preview", async () => {
    render(<ImportSharedStepsWizard open onClose={vi.fn()} />);

    fireEvent.change(screen.getByTestId("file-upload"), {
      target: {
        files: [new File(["x"], "steps.csv", { type: "text/csv" })],
      },
    });
    fireEvent.click(screen.getByTestId("next-button"));

    const selects = await screen.findAllByTestId("column-select");
    expect(selects).toHaveLength(COLUMNS.length);
    fireEvent.change(selects[1], { target: { value: "combinedStepData" } });
    fireEvent.change(selects[2], { target: { value: "stepsData" } });
    const notes = selects[3] as HTMLSelectElement;
    expect(notes.value).toBe("ignore");
    fireEvent.change(notes, { target: { value: "expectedResult" } });

    fireEvent.click(screen.getByTestId("next-button"));
    expect(screen.queryAllByTestId("column-select")).toHaveLength(0);

    fireEvent.click(screen.getByText("common.actions.previous"));

    const again = (await screen.findAllByTestId(
      "column-select"
    )) as HTMLSelectElement[];
    expect(again.map((select) => select.value)).toEqual([
      "groupName",
      "combinedStepData",
      "stepsData",
      "expectedResult",
    ]);
    expect(mocks.parse).toHaveBeenCalledTimes(1);
  });

  describe("applying a saved mapping", () => {
    const saved = (columns: Array<[string, string | null]>, settings = {}) => ({
      id: "m1",
      name: "Weekly export",
      templateId: null,
      config: {
        version: 1,
        columns: columns.map(([column, field]) => ({ column, field })),
        settings,
      },
    });

    async function openMappingPage() {
      render(<ImportSharedStepsWizard open onClose={vi.fn()} />);
      fireEvent.change(screen.getByTestId("file-upload"), {
        target: {
          files: [new File(["x"], "steps.csv", { type: "text/csv" })],
        },
      });
      fireEvent.click(screen.getByTestId("next-button"));
      await screen.findAllByTestId("column-select");
    }

    const values = () =>
      (screen.getAllByTestId("column-select") as HTMLSelectElement[]).map(
        (select) => select.value
      );

    beforeEach(() => {
      mocks.result = undefined;
    });

    it("maps saved columns and keeps the auto-match on the rest", async () => {
      mocks.toApply = saved([
        ["Notes", "expectedResult"],
        ["Steps Data", "stepsData"],
        ["Owner", "order"],
      ]);
      await openMappingPage();

      fireEvent.click(screen.getByTestId("apply-saved-mapping"));

      await waitFor(() => expect(mocks.result).toBeDefined());
      // "Combined Step Data" isn't in the saved mapping, so it keeps the
      // auto-match (the "step" alias).
      expect(values()).toEqual([
        "groupName",
        "step",
        "stepsData",
        "expectedResult",
      ]);
      expect(mocks.result).toMatchObject({ missingColumns: ["Owner"] });
      expect(mocks.parse).toHaveBeenCalledTimes(1);
    });

    it("re-reads the file with the saved settings before mapping", async () => {
      mocks.parse.mockImplementation((_text, options) =>
        options.complete({
          data: [],
          meta: {
            fields:
              options.delimiter === ";"
                ? ["Group", "Action", "Notes"]
                : ["Group;Action;Notes"],
          },
          errors: [],
        })
      );
      mocks.toApply = saved(
        [
          ["Group", "groupName"],
          ["Action", "stepContent"],
          ["Notes", "expectedResultContent"],
        ],
        { delimiter: ";", rowMode: "multi" }
      );
      await openMappingPage();
      expect(values()).toHaveLength(1);

      fireEvent.click(screen.getByTestId("apply-saved-mapping"));

      await waitFor(() => expect(mocks.result).toBeDefined());
      expect(mocks.parse).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ delimiter: ";" })
      );
      expect(values()).toEqual([
        "groupName",
        "stepContent",
        "expectedResultContent",
      ]);
      expect(mocks.savedProps.current.settings).toMatchObject({
        delimiter: ";",
        rowMode: "multi",
      });
      expect(mocks.result).toMatchObject({
        missingColumns: [],
        unavailableFields: [],
      });
    });
  });
});
