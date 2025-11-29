import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import Papa from "papaparse";
import { useExportData, TFunction } from "./useExportData";
import { ExportOptions } from "../app/[locale]/projects/repository/[projectId]/ExportModal";
import { CustomColumnDef } from "../components/tables/ColumnSelection";
import { extractTextFromNode } from "../utils/extractTextFromJson";

// --- Mocks ---

// Hoist mock function definitions
const { mockUnparse } = vi.hoisted(() => {
  return { mockUnparse: vi.fn() };
});
const { mockExtractText } = vi.hoisted(() => {
  return { mockExtractText: vi.fn() };
});

// Mock Papa.unparse using the hoisted mock
vi.mock("papaparse", () => ({
  // Provide both default and named export for compatibility
  default: { unparse: mockUnparse },
  unparse: mockUnparse,
}));

// Mock extractTextFromNode using the hoisted mock
vi.mock("../utils/extractTextFromJson", () => ({
  extractTextFromNode: mockExtractText,
}));

// Mock next-intl (provide a simple t function)
const mockT: TFunction = (key: string) => key;
vi.mock("next-intl", () => ({
  useTranslations: () => mockT,
}));

// Mock Browser APIs for download simulation
const mockLinkClick = vi.fn();
const mockAppendChild = vi.fn();
const mockRemoveChild = vi.fn();
const mockCreateObjectURL = vi.fn();
const mockRevokeObjectURL = vi.fn();

// Remove these global document mocks
// global.document.createElement = vi.fn(() => ({
//   click: mockLinkClick,
//   setAttribute: vi.fn(),
//   style: { visibility: '' },
// })) as any;
// global.document.body.appendChild = mockAppendChild;
// global.document.body.removeChild = mockRemoveChild;

global.URL.createObjectURL = mockCreateObjectURL;
global.URL.revokeObjectURL = mockRevokeObjectURL;

// --- Helper Data & Types ---
type SampleDataType = {
  id: number;
  name: string;
  state?: { name: string };
  template?: { templateName: string; caseFields?: any[] };
  creator?: { name: string };
  tags?: { name: string }[];
  steps?: {
    id: number;
    step: any;
    expectedResult?: { expectedResult: any; isDeleted?: boolean };
    isDeleted?: boolean;
  }[];
  attachments?: {
    id: number;
    name: string;
    url: string;
    note: string;
    size: bigint;
    mimeType: string;
    createdAt: Date;
    isDeleted: boolean;
    testCaseId: number;
    createdById: string;
  }[];
  issues?: { name: string }[];
  caseFieldValues?: { fieldId: number; value: any }[];
  order?: number;
  automated?: boolean;
  // Add other fields as needed by columns
  createdAt?: Date;
  [key: string]: any; // Allow dynamic access
};

const sampleColumns: CustomColumnDef<SampleDataType>[] = [
  { id: "id", header: "ID", accessorKey: "id", enableHiding: true },
  { id: "name", header: "Name", accessorKey: "name", enableHiding: true },
  {
    id: "stateId",
    header: "State",
    accessorFn: (row) => row.state?.name,
    enableHiding: true,
  },
  {
    id: "template",
    header: "Template",
    accessorFn: (row) => row.template?.templateName,
    enableHiding: true,
  },
  {
    id: "creator",
    header: "Creator",
    accessorFn: (row) => row.creator?.name,
    enableHiding: true,
  },
  {
    id: "tags",
    header: "Tags",
    accessorFn: (row) => row.tags?.map((t) => t.name).join(", "),
    enableHiding: true,
  },
  { id: "attachments", header: "Attachments", enableHiding: true }, // Processed specially
  {
    id: "issues",
    header: "Issues",
    accessorFn: (row) => row.issues?.map((i) => i.name).join(", "),
    enableHiding: true,
  },
  { id: "steps", header: "Steps", enableHiding: true }, // Special handling indicator
  {
    id: "automated",
    header: "Automated",
    accessorKey: "automated",
    enableHiding: true,
  },
  {
    id: "createdAt",
    header: "Created At",
    accessorKey: "createdAt",
    enableHiding: true,
  },
  // Custom Fields (Example)
  { id: "101", header: "Custom Text", enableHiding: true }, // Assume 101 is ID for a Text String field
  { id: "102", header: "Custom Dropdown", enableHiding: true }, // Assume 102 is ID for a Dropdown
  { id: "103", header: "Custom Text Long", enableHiding: true }, // Assume 103 is ID for Text Long
  { id: "104", header: "Custom Checkbox", enableHiding: true }, // Assume 104 is ID for Checkbox
  { id: "105", header: "Custom Multi", enableHiding: true }, // Assume 105 is ID for Multi-Select
];

const sampleData: SampleDataType[] = [
  {
    id: 1,
    name: "Test Case One",
    state: { name: "Draft" },
    template: {
      templateName: "Basic",
      caseFields: [
        { caseField: { id: 101, type: { type: "Text String" } } },
        {
          caseField: {
            id: 102,
            type: { type: "Dropdown" },
            fieldOptions: [{ fieldOption: { id: 201, name: "Option A" } }],
          },
        },
        { caseField: { id: 103, type: { type: "Text Long" } } },
        { caseField: { id: 104, type: { type: "Checkbox" } } },
        {
          caseField: {
            id: 105,
            type: { type: "Multi-Select" },
            fieldOptions: [
              { fieldOption: { id: 301, name: "Multi A" } },
              { fieldOption: { id: 302, name: "Multi B" } },
              { fieldOption: { id: 303, name: "Multi C" } },
            ],
          },
        },
      ],
    },
    creator: { name: "User A" },
    tags: [{ name: "smoke" }, { name: "regression" }],
    steps: [
      {
        id: 10,
        step: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Step 1 content" }],
            },
          ],
        },
        expectedResult: {
          expectedResult: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Result 1 content" }],
              },
            ],
          },
        },
        isDeleted: false,
      },
      {
        id: 11,
        step: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Step 2 content" }],
            },
          ],
        },
        isDeleted: false,
      },
      {
        id: 12,
        step: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Step 3 deleted" }],
            },
          ],
        },
        isDeleted: true,
      },
    ],
    attachments: [
      {
        id: 301,
        name: "file1.txt",
        url: "url1",
        note: "",
        size: 100n,
        mimeType: "text/plain",
        createdAt: new Date(),
        isDeleted: false,
        testCaseId: 1,
        createdById: "user-a",
      },
    ],
    issues: [{ name: "ISSUE-1" }],
    caseFieldValues: [
      { fieldId: 101, value: "Custom value one" },
      { fieldId: 102, value: 201 }, // ID for Option A
      {
        fieldId: 103,
        value: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Long text here" }],
            },
          ],
        }),
      },
      { fieldId: 104, value: true },
      { fieldId: 105, value: [301, 303] },
    ],
    order: 1,
    automated: false,
    createdAt: new Date(2024, 0, 1),
  },
  {
    id: 2,
    name: "Test Case Two",
    state: { name: "Ready" },
    template: {
      templateName: "Basic",
      caseFields: [
        { caseField: { id: 101, type: { type: "Text String" } } },
        {
          caseField: {
            id: 102,
            type: { type: "Dropdown" },
            fieldOptions: [{ fieldOption: { id: 202, name: "Option B" } }],
          },
        },
        { caseField: { id: 103, type: { type: "Text Long" } } },
      ],
    },
    creator: { name: "User B" },
    steps: [], // No steps
    attachments: [],
    caseFieldValues: [{ fieldId: 101, value: "Another value" }],
    order: 2,
    automated: true,
    createdAt: new Date(2024, 0, 2),
  },
];

const mockFetchAllData = vi.fn();

interface RenderHookProps {
  fetchAllData?: (options: ExportOptions) => Promise<SampleDataType[]>;
  currentData?: SampleDataType[];
  selectedIds?: number[];
  columns?: CustomColumnDef<SampleDataType>[];
  columnVisibility?: Record<string, boolean>;
  fileNamePrefix?: string;
}

const renderExportHook = (props: RenderHookProps = {}) => {
  const defaultProps = {
    fetchAllData: mockFetchAllData,
    currentData: sampleData,
    selectedIds: [],
    columns: sampleColumns,
    columnVisibility: sampleColumns.reduce(
      (acc, col) => ({ ...acc, [col.id as string]: true }),
      {}
    ),
    fileNamePrefix: "test-export",
    t: mockT,
    project: { id: 1, name: "Test Project" } as any, // Add minimal project mock
    isRunMode: false,
    testRunCasesData: [],
    isDefaultSort: true,
    textLongFormat: "json", // default
    attachmentFormat: "json", // default
    ...props,
  };
  return renderHook(() => useExportData<SampleDataType>(defaultProps));
};

// --- Tests ---
describe("useExportData", () => {
  beforeEach(() => {
    // Reset mocks before each test
    mockUnparse.mockClear();
    mockExtractText.mockClear();
    mockCreateObjectURL.mockClear();
    mockRevokeObjectURL.mockClear();
    mockFetchAllData.mockClear();

    // Default mock implementations
    mockFetchAllData.mockResolvedValue(sampleData);
    mockExtractText.mockImplementation((node) => JSON.stringify(node)); // Simple fallback
    mockCreateObjectURL.mockReturnValue("blob:testurl");
  });

  it("should initialize with isExporting as false", () => {
    const { result } = renderExportHook();
    expect(result.current.isExporting).toBe(false);
  });

  it("should set isExporting during export and reset after", async () => {
    const { result } = renderExportHook({ selectedIds: [1] });
    const options: ExportOptions = {
      format: "csv",
      scope: "selected",
      columns: "visible",
      delimiter: ",",
      rowMode: "single",
      stepsFormat: "json",
      textLongFormat: "json",
      attachmentFormat: "json",
    };

    expect(result.current.isExporting).toBe(false); // Check initial state

    // Use await act directly
    await act(async () => {
      await result.current.handleExport(options);
    });

    // Check final state AFTER the async operation and act complete
    expect(result.current.isExporting).toBe(false);
  });

  it("should call fetchAllData when scope is allFiltered", async () => {
    const { result } = renderExportHook();
    const options: ExportOptions = {
      format: "csv",
      scope: "allFiltered",
      columns: "visible",
      delimiter: ",",
      rowMode: "single",
      stepsFormat: "json",
      textLongFormat: "json",
      attachmentFormat: "json",
    };
    await act(async () => {
      await result.current.handleExport(options);
    });
    expect(mockFetchAllData).toHaveBeenCalledTimes(1);
    expect(mockFetchAllData).toHaveBeenCalledWith(options); // Ensure options are passed
    expect(mockUnparse).toHaveBeenCalled(); // Check if export proceeded
  });

  it("should use currentData when scope is selected", async () => {
    const { result } = renderExportHook({ selectedIds: [1] });
    const options: ExportOptions = {
      format: "csv",
      scope: "selected",
      columns: "visible",
      delimiter: ",",
      rowMode: "single",
      stepsFormat: "json",
      textLongFormat: "json",
      attachmentFormat: "json",
    };
    await act(async () => {
      await result.current.handleExport(options);
    });
    expect(mockFetchAllData).not.toHaveBeenCalled();
    expect(mockUnparse).toHaveBeenCalledTimes(1);
    // Check if only selected data was processed
    const unparseData = mockUnparse.mock.calls[0][0];
    expect(unparseData).toHaveLength(1);
    // Check ID - it gets converted to string in formatting
    expect(unparseData[0]["ID"]).toBe("1"); // Changed expectation to string '1'
  });

  it("should fetch all data when selected items are not in currentData", async () => {
    // currentData only has items with id 1 and 2
    const { result } = renderExportHook({ 
      selectedIds: [1, 3, 4], // 3 and 4 are not in currentData
      currentData: sampleData // sampleData only has items with id 1 and 2
    });
    
    // Mock fetchAllData to return additional items
    const allData = [
      ...sampleData,
      { ...sampleData[0], id: 3, name: "Test Case Three" },
      { ...sampleData[0], id: 4, name: "Test Case Four" }
    ];
    mockFetchAllData.mockResolvedValue(allData);
    
    const options: ExportOptions = {
      format: "csv",
      scope: "selected",
      columns: "visible",
      delimiter: ",",
      rowMode: "single",
      stepsFormat: "json",
      textLongFormat: "json",
      attachmentFormat: "json",
    };
    
    await act(async () => {
      await result.current.handleExport(options);
    });
    
    // Should call fetchAllData since not all selected items are in currentData
    expect(mockFetchAllData).toHaveBeenCalledTimes(1);
    expect(mockFetchAllData).toHaveBeenCalledWith({ ...options, scope: "allFiltered" });
    expect(mockUnparse).toHaveBeenCalledTimes(1);
    
    // Check if only selected data was processed
    const unparseData = mockUnparse.mock.calls[0][0];
    expect(unparseData).toHaveLength(3); // Only 3 items (1, 3, 4) should be exported
    expect(unparseData.map((d: any) => d["ID"])).toEqual(["1", "3", "4"]);
  });

  it("should handle no data to export", async () => {
    const { result } = renderExportHook({ currentData: [], selectedIds: [] });
    const options: ExportOptions = {
      format: "csv",
      scope: "selected",
      columns: "visible",
      delimiter: ",",
      rowMode: "single",
      stepsFormat: "json",
      textLongFormat: "json",
      attachmentFormat: "json",
    };
    await act(async () => {
      await result.current.handleExport(options);
    });
    expect(mockUnparse).not.toHaveBeenCalled();
    expect(result.current.isExporting).toBe(false);
    // We could also check for a console.warn or a potential toast mock call here
  });

  it("should handle fetchAllData error", async () => {
    mockFetchAllData.mockRejectedValue(new Error("Fetch failed"));
    const { result } = renderExportHook();
    const options: ExportOptions = {
      format: "csv",
      scope: "allFiltered",
      columns: "visible",
      delimiter: ",",
      rowMode: "single",
      stepsFormat: "json",
      textLongFormat: "json",
      attachmentFormat: "json",
    };

    await act(async () => {
      await result.current.handleExport(options);
    });

    expect(mockUnparse).not.toHaveBeenCalled();
    expect(result.current.isExporting).toBe(false);
    // We could also check for a console.error or a potential toast mock call here
  });

  it("should filter columns based on visibility when columns is visible", async () => {
    const visibility = {
      id: true,
      name: true,
      stateId: false,
      template: false,
      creator: false,
      tags: false,
      attachments: false,
      issues: false,
      steps: false,
      automated: true,
      createdAt: false,
      "101": false,
      "102": false,
      "103": false,
    };
    const { result } = renderExportHook({
      selectedIds: [1],
      columnVisibility: visibility,
    });
    const options: ExportOptions = {
      format: "csv",
      scope: "selected",
      columns: "visible",
      delimiter: ",",
      rowMode: "single",
      stepsFormat: "json",
      textLongFormat: "json",
      attachmentFormat: "json",
    };
    await act(async () => {
      await result.current.handleExport(options);
    });
    expect(mockUnparse).toHaveBeenCalledTimes(1);
    const headers = Object.keys(mockUnparse.mock.calls[0][0][0]);
    // Added 'Steps Data' to expected headers for single row mode
    expect(headers).toEqual(["ID", "Name", "Automated", "Steps Data"]);
  });

  it("should use all defined columns when columns is all", async () => {
    const visibility = { id: false, name: true }; // Visibility should be ignored
    const { result } = renderExportHook({
      selectedIds: [1],
      columnVisibility: visibility,
    });
    const options: ExportOptions = {
      format: "csv",
      scope: "selected",
      columns: "all",
      delimiter: ",",
      rowMode: "single",
      stepsFormat: "json",
      textLongFormat: "json",
      attachmentFormat: "json",
    };
    await act(async () => {
      await result.current.handleExport(options);
    });
    expect(mockUnparse).toHaveBeenCalledTimes(1);
    const headers = Object.keys(mockUnparse.mock.calls[0][0][0]);
    const expectedHeaders = sampleColumns
      .filter(
        (col) =>
          !["actions", "customSelect", "select", "steps"].includes(
            col.id as string
          )
      )
      .map((col) => (typeof col.header === "string" ? col.header : col.id));
    // Add the dynamically added step column for single row mode
    expectedHeaders.push("Steps Data");
    expect(headers).toEqual(expect.arrayContaining(expectedHeaders));
    expect(headers).toHaveLength(expectedHeaders.length);
  });

  // --- Add tests for rowMode, stepsFormat, attachmentFormat, textLongFormat, custom fields, delimiters, etc. ---

  it("should simulate download link click", async () => {
    const { result } = renderExportHook({ selectedIds: [1] });
    const options: ExportOptions = {
      format: "csv",
      scope: "selected",
      columns: "visible",
      delimiter: ",",
      rowMode: "single",
      stepsFormat: "json",
      textLongFormat: "json",
      attachmentFormat: "json",
    };
    mockUnparse.mockReturnValue("csv,string");

    // Spy on document methods more robustly
    const createElementSpy = vi.spyOn(document, "createElement");
    const appendChildSpy = vi.spyOn(document.body, "appendChild");
    const removeChildSpy = vi.spyOn(document.body, "removeChild");

    // Create a real anchor element to spy on
    const linkElement = document.createElement("a");
    const clickSpy = vi.spyOn(linkElement, "click");
    const setAttributeSpy = vi.spyOn(linkElement, "setAttribute");
    createElementSpy.mockReturnValue(linkElement);

    await act(async () => {
      await result.current.handleExport(options);
    });

    expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
    expect(createElementSpy).toHaveBeenCalledWith("a");
    expect(setAttributeSpy).toHaveBeenCalledWith("href", "blob:testurl");
    expect(setAttributeSpy).toHaveBeenCalledWith(
      "download",
      expect.stringContaining("test-export-export-")
    ); // Check filename prefix
    expect(appendChildSpy).toHaveBeenCalledWith(linkElement);
    expect(clickSpy).toHaveBeenCalledTimes(1); // Check the click spy on the actual element
    expect(removeChildSpy).toHaveBeenCalledWith(linkElement);
    expect(mockRevokeObjectURL).toHaveBeenCalledTimes(1);
    expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:testurl");

    // Restore spies
    createElementSpy.mockRestore();
    appendChildSpy.mockRestore();
    removeChildSpy.mockRestore();
    clickSpy.mockRestore();
    setAttributeSpy.mockRestore();
  });

  it("should format data into multiple rows when rowMode is multi", async () => {
    const { result } = renderExportHook({ selectedIds: [1] }); // Test Case One has 2 active steps
    const options: ExportOptions = {
      format: "csv",
      scope: "selected",
      columns: "all",
      delimiter: ",",
      rowMode: "multi",
      stepsFormat: "json",
      textLongFormat: "json",
      attachmentFormat: "json",
    };

    await act(async () => {
      await result.current.handleExport(options);
    });

    expect(mockUnparse).toHaveBeenCalledTimes(1);
    const unparsedData = mockUnparse.mock.calls[0][0];
    expect(unparsedData).toHaveLength(2); // TC 1 should have 2 rows for its 2 active steps

    // Check headers include step columns
    const headers = Object.keys(unparsedData[0]);
    expect(headers).toContain("Step #");
    expect(headers).toContain("Step Content");
    expect(headers).toContain("Expected Result");
    expect(headers).not.toContain("Steps Data"); // Should not have combined column

    // Check first row (first step)
    expect(unparsedData[0]["ID"]).toBe("1");
    expect(unparsedData[0]["Name"]).toBe("Test Case One");
    expect(unparsedData[0]["Step #"]).toBe("1");
    expect(unparsedData[0]["Step Content"]).toContain("Step 1 content");
    expect(unparsedData[0]["Expected Result"]).toContain("Result 1 content");

    // Check second row (second step)
    expect(unparsedData[1]["ID"]).toBe("1"); // Should still have ID and Name for reference
    expect(unparsedData[1]["Name"]).toBe("Test Case One");
    expect(unparsedData[1]["Step #"]).toBe("2");
    expect(unparsedData[1]["Step Content"]).toContain("Step 2 content");
    expect(unparsedData[1]["Expected Result"]).toBe(""); // Step 2 has no expected result
    // Check if other fields are blanked out as expected for continuation rows
    expect(unparsedData[1]["State"]).toBe("");
    expect(unparsedData[1]["Template"]).toBe("");
    // ... add checks for other potentially blanked columns if needed
  });

  it("should format step data as plain text in single row mode", async () => {
    mockExtractText.mockImplementation((node) => {
      // Basic mock for plain text extraction
      if (node?.content?.[0]?.content?.[0]?.text) {
        return node.content[0].content[0].text;
      }
      return "Extracted Text";
    });
    const { result } = renderExportHook({ selectedIds: [1] });
    const options: ExportOptions = {
      format: "csv",
      scope: "selected",
      columns: "all",
      delimiter: ",",
      rowMode: "single",
      stepsFormat: "plainText",
      textLongFormat: "json",
      attachmentFormat: "json",
    };

    await act(async () => {
      await result.current.handleExport(options);
    });

    expect(mockUnparse).toHaveBeenCalledTimes(1);
    const unparsedData = mockUnparse.mock.calls[0][0];
    expect(unparsedData).toHaveLength(1);
    expect(unparsedData[0]["Steps Data"]).toBe(
      "Step 1:\nStep 1 content\nExpected Result 1:\nResult 1 content\n---\nStep 2:\nStep 2 content"
    ); // Based on sample data and plain text formatting
  });

  it("should format step data as plain text in multi row mode", async () => {
    mockExtractText.mockImplementation((node) => {
      if (node?.content?.[0]?.content?.[0]?.text) {
        return node.content[0].content[0].text;
      }
      return "Extracted Text";
    });
    const { result } = renderExportHook({ selectedIds: [1] });
    const options: ExportOptions = {
      format: "csv",
      scope: "selected",
      columns: "all",
      delimiter: ",",
      rowMode: "multi",
      stepsFormat: "plainText",
      textLongFormat: "json",
      attachmentFormat: "json",
    };

    await act(async () => {
      await result.current.handleExport(options);
    });

    expect(mockUnparse).toHaveBeenCalledTimes(1);
    const unparsedData = mockUnparse.mock.calls[0][0];
    expect(unparsedData).toHaveLength(2);
    expect(unparsedData[0]["Step Content"]).toBe("Step 1 content");
    expect(unparsedData[0]["Expected Result"]).toBe("Result 1 content");
    expect(unparsedData[1]["Step Content"]).toBe("Step 2 content");
    expect(unparsedData[1]["Expected Result"]).toBe("");
  });

  // --- Add tests for attachmentFormat, textLongFormat, custom fields, delimiters, etc. ---

  it("should simulate download link click", async () => {
    const { result } = renderExportHook({ selectedIds: [1] });
    const options: ExportOptions = {
      format: "csv",
      scope: "selected",
      columns: "visible",
      delimiter: ",",
      rowMode: "single",
      stepsFormat: "json",
      textLongFormat: "json",
      attachmentFormat: "json",
    };
    mockUnparse.mockReturnValue("csv,string");

    // Spy on document methods more robustly
    const createElementSpy = vi.spyOn(document, "createElement");
    const appendChildSpy = vi.spyOn(document.body, "appendChild");
    const removeChildSpy = vi.spyOn(document.body, "removeChild");

    // Create a real anchor element to spy on
    const linkElement = document.createElement("a");
    const clickSpy = vi.spyOn(linkElement, "click");
    const setAttributeSpy = vi.spyOn(linkElement, "setAttribute");
    createElementSpy.mockReturnValue(linkElement);

    await act(async () => {
      await result.current.handleExport(options);
    });

    expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
    expect(createElementSpy).toHaveBeenCalledWith("a");
    expect(setAttributeSpy).toHaveBeenCalledWith("href", "blob:testurl");
    expect(setAttributeSpy).toHaveBeenCalledWith(
      "download",
      expect.stringContaining("test-export-export-")
    ); // Check filename prefix
    expect(appendChildSpy).toHaveBeenCalledWith(linkElement);
    expect(clickSpy).toHaveBeenCalledTimes(1); // Check the click spy on the actual element
    expect(removeChildSpy).toHaveBeenCalledWith(linkElement);
    expect(mockRevokeObjectURL).toHaveBeenCalledTimes(1);
    expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:testurl");

    // Restore spies
    createElementSpy.mockRestore();
    appendChildSpy.mockRestore();
    removeChildSpy.mockRestore();
    clickSpy.mockRestore();
    setAttributeSpy.mockRestore();
  });

  it("should format Text Long fields as plain text when specified", async () => {
    mockExtractText.mockImplementation((node) => {
      if (node?.content?.[0]?.content?.[0]?.text) {
        return node.content[0].content[0].text;
      }
      return "Extracted Long Text";
    });
    const { result } = renderExportHook({ selectedIds: [1] });
    const options: ExportOptions = {
      format: "csv",
      scope: "selected",
      columns: "all",
      delimiter: ",",
      rowMode: "single",
      stepsFormat: "json",
      textLongFormat: "plainText",
      attachmentFormat: "json",
    };

    await act(async () => {
      await result.current.handleExport(options);
    });

    expect(mockUnparse).toHaveBeenCalledTimes(1);
    const unparsedData = mockUnparse.mock.calls[0][0];
    expect(unparsedData[0]["Custom Text Long"]).toBe("Long text here");
  });

  it("should format attachments as names when specified", async () => {
    const { result } = renderExportHook({ selectedIds: [1] });
    const options: ExportOptions = {
      format: "csv",
      scope: "selected",
      columns: "all",
      delimiter: ",",
      rowMode: "single",
      stepsFormat: "json",
      textLongFormat: "json",
      attachmentFormat: "names",
    };

    await act(async () => {
      await result.current.handleExport(options);
    });

    expect(mockUnparse).toHaveBeenCalledTimes(1);
    const unparsedData = mockUnparse.mock.calls[0][0];
    expect(unparsedData[0]["Attachments"]).toBe("file1.txt");
  });

  it("should use the specified delimiter", async () => {
    const { result } = renderExportHook({ selectedIds: [1] });
    const options: ExportOptions = {
      format: "csv",
      scope: "selected",
      columns: "visible",
      delimiter: ";",
      rowMode: "single",
      stepsFormat: "json",
      textLongFormat: "json",
      attachmentFormat: "json",
    };

    await act(async () => {
      await result.current.handleExport(options);
    });

    expect(mockUnparse).toHaveBeenCalledTimes(1);
    const unparseOptions = mockUnparse.mock.calls[0][1];
    expect(unparseOptions?.delimiter).toBe(";");
  });

  it("should format custom field types correctly (Dropdown, Checkbox, Multi-Select)", async () => {
    const { result } = renderExportHook({ selectedIds: [1] });
    const options: ExportOptions = {
      format: "csv",
      scope: "selected",
      columns: "all",
      delimiter: ",",
      rowMode: "single",
      stepsFormat: "json",
      textLongFormat: "json",
      attachmentFormat: "json",
    };

    await act(async () => {
      await result.current.handleExport(options);
    });

    expect(mockUnparse).toHaveBeenCalledTimes(1);
    const unparsedData = mockUnparse.mock.calls[0][0];
    expect(unparsedData).toHaveLength(1);

    // Check custom field formatted values based on sampleData and template mock
    expect(unparsedData[0]["Custom Text"]).toBe("Custom value one");
    expect(unparsedData[0]["Custom Dropdown"]).toBe("Option A"); // Name corresponding to ID 201
    expect(unparsedData[0]["Custom Checkbox"]).toBe(true); // Boolean value
    expect(unparsedData[0]["Custom Multi"]).toBe("Multi A, Multi C"); // Names corresponding to IDs 301, 303
  });
});
