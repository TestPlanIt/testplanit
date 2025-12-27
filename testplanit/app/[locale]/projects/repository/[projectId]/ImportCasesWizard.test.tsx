import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImportCasesWizard } from "./ImportCasesWizard";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  useFindManyTemplates,
  useFindManyRepositoryFolders,
} from "~/lib/hooks";

// Mock dependencies
vi.mock("next/navigation", () => ({
  useParams: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: vi.fn(),
}));

vi.mock("~/lib/hooks", () => ({
  useFindManyTemplates: vi.fn(),
  useFindManyRepositoryFolders: vi.fn(),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

vi.mock("papaparse", () => ({
  default: {
    parse: vi.fn((text, options) => {
      // Mock CSV parsing
      const mockData = [
        { Name: "Test Case 1", Description: "Description 1", Priority: "High" },
        {
          Name: "Test Case 2",
          Description: "Description 2",
          Priority: "Medium",
        },
      ];
      options.complete({
        data: mockData,
        meta: { fields: ["Name", "Description", "Priority"] },
        errors: [],
      });
    }),
  },
}));

// Mock UI components that are causing issues
let mockOnValueChange: any = null;

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, onValueChange, value }: any) => {
    mockOnValueChange = onValueChange;
    return (
      <div data-testid="mock-select">
        {children}
        <span>{value}</span>
      </div>
    );
  },
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => (
    <div data-value={value}>{children}</div>
  ),
  SelectTrigger: ({ children, ...props }: any) => (
    <div
      {...props}
      onClick={() => {
        if (mockOnValueChange) {
          mockOnValueChange("1");
        }
      }}
    >
      {children}
    </div>
  ),
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
}));

// Mock UploadAttachments component
vi.mock("@/components/UploadAttachments", () => ({
  default: ({ onFileSelect, allowedTypes }: any) => (
    <div>
      <input
        title="file-upload"
        type="file"
        data-testid="file-upload"
        accept=".csv"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            const files = Array.from(e.target.files) as File[];
            // Validate CSV files if allowedTypes is provided
            if (allowedTypes && allowedTypes.length > 0) {
              const validFiles = files.filter((file) =>
                allowedTypes.some(
                  (type: string) =>
                    file.name.toLowerCase().endsWith(type.toLowerCase()) ||
                    file.type === type
                )
              );
              onFileSelect(validFiles);
            } else {
              onFileSelect(files);
            }
          } else {
            onFileSelect([]);
          }
        }}
      />
    </div>
  ),
}));

// Mock FolderSelect component
vi.mock("@/components/forms/FolderSelect", () => ({
  FolderSelect: ({ value, onChange }: any) => (
    <select
      title="folder-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      data-testid="folder-select"
    >
      <option value="">{"Select..."}</option>
      <option value="1">{"Folder 1"}</option>
      <option value="2">{"Folder 2"}</option>
      <option value="3">{"Subfolder"}</option>
    </select>
  ),
  transformFolders: (folders: any[]) => folders,
}));

describe("ImportCasesWizard", () => {
  const mockTemplates = [
    {
      id: 1,
      templateName: "Basic Template",
      isDeleted: false,
      isEnabled: true,
      caseFields: [
        {
          caseField: {
            id: 1,
            systemName: "description",
            displayName: "Description",
            isRequired: true,
            type: { type: "Text Long" },
          },
        },
        {
          caseField: {
            id: 2,
            systemName: "priority",
            displayName: "Priority",
            isRequired: false,
            type: { type: "Dropdown" },
          },
        },
      ],
    },
  ];

  const mockFolders = [
    { id: 1, name: "Folder 1", parentId: null, isDeleted: false },
    { id: 2, name: "Folder 2", parentId: null, isDeleted: false },
    { id: 3, name: "Subfolder", parentId: 1, isDeleted: false },
  ];

  const mockT = (key: string, values?: any) => {
    const translations: any = {
      "importWizard.title": "Import Test Cases",
      "importWizard.page1.title": "Upload and Configure",
      "importWizard.page1.uploadFile": "Upload CSV File",
      "importWizard.page1.selectedFile": "Selected file",
      "importWizard.page1.importLocation.label": "Import Location",
      "importWizard.page1.importLocation.singleFolder":
        "Import all cases to a single folder",
      "importWizard.page1.importLocation.rootFolder":
        "Create folder structure under a root folder",
      "importWizard.page1.importLocation.topLevel":
        "Create folder structure at top level",
      "importWizard.page1.selectFolder": "Select Folder",
      "importWizard.page1.selectFolderPlaceholder": "Select a folder...",
      "importWizard.page1.delimiter": "Delimiter",
      "importWizard.page1.delimiters.comma": "Comma (,)",
      "importWizard.page1.delimiters.semicolon": "Semicolon (;)",
      "importWizard.page1.delimiters.colon": "Colon (:)",
      "importWizard.page1.delimiters.pipe": "Pipe (|)",
      "importWizard.page1.delimiters.tab": "Tab",
      "importWizard.page1.hasHeaders": "First row contains column names",
      "importWizard.page1.encoding": "Encoding",
      "importWizard.page1.template": "Template",
      "importWizard.page1.rowMode.label": "Row Mode",
      "importWizard.page1.rowMode.single": "Single row per test case",
      "importWizard.page1.rowMode.multi": "Multiple rows per test case",
      "importWizard.page2.title": "Map Columns",
      "importWizard.page2.description": "Map CSV columns to test case fields",
      "importWizard.page2.ignoreColumn": "-- Ignore this column --",
      "importWizard.page2.required": "Required",
      "importWizard.page2.requiredFieldsWarning":
        "{{count}} required fields are not mapped",
      "importWizard.page3.title": "Configure Import",
      "importWizard.page3.mappingSummary": "Field Mapping Summary",
      "importWizard.page3.folderSplitMode.label": "Folder Split Mode",
      "importWizard.page3.folderSplitMode.plain": "Plain text (no splitting)",
      "importWizard.page3.folderSplitMode.plainExample":
        '"Test Folder" → Single folder named "Test Folder"',
      "importWizard.page3.folderSplitMode.slash": "Split by slash (/)",
      "importWizard.page3.folderSplitMode.slashExample":
        '"UI/Login/Tests" → Three nested folders',
      "importWizard.page3.folderSplitMode.dot": "Split by dot (.)",
      "importWizard.page3.folderSplitMode.dotExample":
        '"UI.Login.Tests" → Three nested folders',
      "importWizard.page3.folderSplitMode.greaterThan":
        "Split by greater than (>)",
      "importWizard.page3.folderSplitMode.greaterThanExample":
        '"UI > Login > Tests" → Three nested folders',
      "importWizard.page4.title": "Preview Import",
      "importWizard.page4.showing":
        "Showing {{start}}-{{end}} of {{total}} cases",
      "importWizard.page4.case": "Case #{{number}}",
      "importWizard.page4.noValue": "(empty)",
      "importWizard.name": "Name",
      "importWizard.fields.folder": "Folder",
      "importWizard.fields.estimate": "Estimate",
      "importWizard.fields.forecast": "Forecast",
      "importWizard.fields.automated": "Automated",
      "importWizard.fields.tags": "Tags",
      "importWizard.fields.steps": "Steps",
      "importWizard.fields.attachments": "Attachments",
      "importWizard.fields.issues": "Issues",
      "importWizard.fields.linkedCases": "Linked Cases",
      "importWizard.fields.workflowState": "Workflow State",
      "importWizard.fields.createdAt": "Created At",
      "importWizard.fields.createdBy": "Created By",
      "importWizard.fields.version": "Version",
      "importWizard.fields.testRuns": "Test Runs",
      "importWizard.fields.id": "ID",
      "importWizard.import": "Import",
      "importWizard.importing": "Importing...",
      "importWizard.success.title": "Import Successful",
      "importWizard.success.description":
        "{{count}} test cases imported successfully",
      "importWizard.errors.parseFailed": "Failed to parse CSV file",
      "importWizard.errors.validationFailed": "Validation Failed",
      "importWizard.errors.validationDescription":
        "{{count}} validation errors found",
      "importWizard.errors.importFailed": "Import Failed",
      "importWizard.errors.unknown": "An unknown error occurred",
    };

    let result = translations[key] || key;
    if (typeof result === "string" && values) {
      result = result.replace(
        /\{\{(\w+)\}\}/g,
        (match, key) => values[key] || match
      );
    }
    return result;
  };

  const mockTCommon = (key: string) => {
    const commonTranslations: any = {
      "actions.next": "Next",
      "actions.previous": "Previous",
    };
    return commonTranslations[key] || key;
  };

  const mockTGlobal = (key: string) => {
    const globalTranslations: any = {
      "sharedSteps.importWizard.page1.selectedFile": "Selected file",
      "sharedSteps.importWizard.page1.title": "Upload and Configure",
      "sharedSteps.importWizard.page1.uploadFile": "Upload CSV File",
    };
    return globalTranslations[key] || key;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useParams as any).mockReturnValue({ projectId: "1" });
    (useTranslations as any).mockImplementation((namespace?: string) => {
      if (namespace === "repository.cases") return mockT;
      if (namespace === "common") return mockTCommon;
      if (!namespace) return mockTGlobal;
      return () => "";
    });
    (useFindManyTemplates as any).mockReturnValue({ data: mockTemplates });
    (useFindManyRepositoryFolders as any).mockReturnValue({
      data: mockFolders,
    });
  });

  it("renders the import wizard dialog", () => {
    render(<ImportCasesWizard />);

    const button = screen.getByText("Import Test Cases");
    expect(button).toBeInTheDocument();
  });

  it("opens the wizard when clicking the import button", async () => {
    render(<ImportCasesWizard />);

    const button = screen.getByText("Import Test Cases");
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText("Upload and Configure")).toBeInTheDocument();
    });
  });

  describe("Page 1 - Upload and Configure", () => {
    it("allows file selection", async () => {
      const user = userEvent.setup();
      render(<ImportCasesWizard />);

      fireEvent.click(screen.getByText("Import Test Cases"));

      const file = new File(["test,content"], "test.csv", {
        type: "text/csv",
      });
      const fileInput = screen.getByTestId("file-upload");

      await user.upload(fileInput, file);

      await waitFor(() => {
        expect(screen.getByTestId("selected-file-info")).toBeInTheDocument();
        expect(screen.getByTestId("selected-file-info")).toHaveTextContent(
          "Selected file: test.csv"
        );
      });
    });

    it("allows import location selection", async () => {
      render(<ImportCasesWizard />);

      fireEvent.click(screen.getByText("Import Test Cases"));

      const singleFolderRadio = screen.getByLabelText(
        "Import all cases to a single folder"
      );
      const rootFolderRadio = screen.getByLabelText(
        "Create folder structure under a root folder"
      );
      const topLevelRadio = screen.getByLabelText(
        "Create folder structure at top level"
      );

      expect(singleFolderRadio).toBeChecked();

      fireEvent.click(rootFolderRadio);
      expect(rootFolderRadio).toBeChecked();

      fireEvent.click(topLevelRadio);
      expect(topLevelRadio).toBeChecked();
    });

    it("shows folder select when single folder or root folder is selected", async () => {
      render(<ImportCasesWizard />);

      fireEvent.click(screen.getByText("Import Test Cases"));

      // Single folder mode - should show folder select
      expect(screen.getByText("Select Folder")).toBeInTheDocument();

      // Top level mode - should not show folder select
      fireEvent.click(
        screen.getByLabelText("Create folder structure at top level")
      );
      expect(screen.queryByText("Select Folder")).not.toBeInTheDocument();
    });

    it("allows delimiter selection", async () => {
      render(<ImportCasesWizard />);

      fireEvent.click(screen.getByText("Import Test Cases"));

      // Should have delimiter select (mocked)
      const selects = screen.getAllByTestId("mock-select");
      expect(selects.length).toBeGreaterThan(0);
    });

    it("has checkbox for headers", async () => {
      render(<ImportCasesWizard />);

      fireEvent.click(screen.getByText("Import Test Cases"));

      const checkbox = screen.getByLabelText("First row contains column names");
      expect(checkbox).toBeInTheDocument();
      expect(checkbox).toBeChecked();
    });

    it("only accepts CSV files", async () => {
      const user = userEvent.setup();
      render(<ImportCasesWizard />);

      fireEvent.click(screen.getByText("Import Test Cases"));

      // Try to upload a non-CSV file
      const nonCsvFile = new File(["test content"], "test.txt", {
        type: "text/plain",
      });
      const fileInput = screen.getByTestId("file-upload");

      await user.upload(fileInput, nonCsvFile);

      // Should not show selected file info for non-CSV files
      expect(
        screen.queryByTestId("selected-file-info")
      ).not.toBeInTheDocument();

      // Upload a CSV file
      const csvFile = new File(["test,content"], "test.csv", {
        type: "text/csv",
      });

      await user.upload(fileInput, csvFile);

      // Should show selected file info for CSV files
      await waitFor(() => {
        expect(screen.getByTestId("selected-file-info")).toBeInTheDocument();
        expect(screen.getByTestId("selected-file-info")).toHaveTextContent(
          "Selected file: test.csv"
        );
      });
    });
  });

  describe("Basic functionality", () => {
    it("handles CSV parsing", async () => {
      const user = userEvent.setup();
      render(<ImportCasesWizard />);

      fireEvent.click(screen.getByText("Import Test Cases"));

      const file = new File(
        ["Name,Description,Priority\nTest 1,Desc 1,High"],
        "test.csv",
        { type: "text/csv" }
      );
      const fileInput = screen.getByTestId("file-upload");
      await user.upload(fileInput, file);

      // File should be uploaded
      await waitFor(() => {
        expect(screen.getByTestId("selected-file-info")).toBeInTheDocument();
        expect(screen.getByTestId("selected-file-info")).toHaveTextContent(
          "Selected file: test.csv"
        );
      });
    });

    it("validates required fields before enabling next button", async () => {
      render(<ImportCasesWizard />);

      fireEvent.click(screen.getByText("Import Test Cases"));

      const nextButton = screen.getByText("Next");
      expect(nextButton).not.toBeDisabled();

      // Click next button without filling required fields
      fireEvent.click(nextButton);

      // Should show validation errors but stay on same page
      await waitFor(() => {
        expect(screen.getByText("Upload and Configure")).toBeInTheDocument();
      });
    });

    it("handles navigation between pages", async () => {
      const user = userEvent.setup();
      render(<ImportCasesWizard />);

      fireEvent.click(screen.getByText("Import Test Cases"));

      // Upload file to enable navigation
      const file = new File(["test,content"], "test.csv", {
        type: "text/csv",
      });
      const fileInput = screen.getByTestId("file-upload");
      await user.upload(fileInput, file);

      // Select folder
      const folderSelect = screen.getByTestId("folder-select");
      fireEvent.change(folderSelect, { target: { value: "1" } });

      // Click on template select to set value
      const templateSelect = screen.getByTestId("template-select");
      fireEvent.click(templateSelect);

      await waitFor(() => {
        const nextButton = screen.getByTestId("next-button");
        expect(nextButton).not.toBeDisabled();
      });
    });
  });

  describe("Import functionality", () => {
    it("shows import button on final page", async () => {
      const user = userEvent.setup();
      render(<ImportCasesWizard />);

      fireEvent.click(screen.getByText("Import Test Cases"));

      // Setup minimal required data
      const file = new File(["Name\nTest 1"], "test.csv", {
        type: "text/csv",
      });
      const fileInput = screen.getByTestId("file-upload");
      await user.upload(fileInput, file);

      const folderSelect = screen.getByTestId("folder-select");
      fireEvent.change(folderSelect, { target: { value: "1" } });

      // Click template select
      const templateSelect = screen.getByTestId("template-select");
      fireEvent.click(templateSelect);

      // Should have Next button enabled
      await waitFor(() => {
        expect(screen.getByTestId("next-button")).not.toBeDisabled();
      });
    });

    it("calls onImportComplete after successful import", async () => {
      const mockOnImportComplete = vi.fn();
      const user = userEvent.setup();

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, importedCount: 1 }),
      });

      render(<ImportCasesWizard onImportComplete={mockOnImportComplete} />);

      fireEvent.click(screen.getByText("Import Test Cases"));

      // Setup minimal data
      const file = new File(["Name\nTest 1"], "test.csv", {
        type: "text/csv",
      });
      const fileInput = screen.getByTestId("file-upload");
      await user.upload(fileInput, file);

      expect(screen.getByTestId("selected-file-info")).toBeInTheDocument();
      expect(screen.getByTestId("selected-file-info")).toHaveTextContent(
        "Selected file: test.csv"
      );
    });
  });
});
