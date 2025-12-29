"use client";

import { useState, useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Download } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import {
  useFindManyTemplates,
  useFindManyRepositoryFolders,
} from "~/lib/hooks";
import {
  FolderSelect,
  transformFolders,
} from "@/components/forms/FolderSelect";
import UploadAttachments from "@/components/UploadAttachments";
import Papa from "papaparse";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { z } from "zod/v4";
import LoadingSpinnerAlert from "@/components/LoadingSpinnerAlert";

interface ImportCasesWizardProps {
  onImportComplete?: () => void;
}

type ImportLocation = "single_folder" | "root_folder" | "top_level";
type Delimiter = "," | ";" | ":" | "|" | "\t";
type Encoding = "UTF-8" | "ISO-8859-1" | "ISO-8859-15" | "Windows-1252";
type RowMode = "single" | "multi";
type FolderSplitMode = "plain" | "slash" | "dot" | "greater_than";

interface FieldMapping {
  csvColumn: string;
  templateField: string | null;
}

interface ParsedCase {
  [key: string]: any;
}

// Zod validation schema for page 1
const createPage1Schema = (t: any, tGlobal: any) =>
  z
    .object({
      selectedFile: z.any().refine((file) => file !== null, {
        message: tGlobal("sharedSteps.importWizard.errors.csvFileRequired"),
      }),
      selectedTemplateId: z.string().min(1, {
        message: t("importWizard.errors.templateRequired"),
      }),
      selectedFolderId: z.string().optional(),
      importLocation: z.enum(["single_folder", "root_folder", "top_level"]),
    })
    .refine(
      (data) => {
        if (data.importLocation === "top_level") {
          return true;
        }
        return data.selectedFolderId && data.selectedFolderId.length > 0;
      },
      {
        message: t("importWizard.errors.folderRequired"),
        path: ["selectedFolderId"],
      }
    );

type Page1ValidationErrors = {
  selectedFile?: string;
  selectedTemplateId?: string;
  selectedFolderId?: string;
};

export function ImportCasesWizard({
  onImportComplete,
}: ImportCasesWizardProps) {
  const t = useTranslations("repository.cases");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const { toast } = useToast();
  const params = useParams();
  const projectId = parseInt(params.projectId as string);

  const [open, setOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);

  // Page 1 state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importLocation, setImportLocation] =
    useState<ImportLocation>("single_folder");
  const [selectedFolderId, setSelectedFolderId] = useState<string>("");
  const [delimiter, setDelimiter] = useState<Delimiter>(",");
  const [hasHeaders, setHasHeaders] = useState(true);
  const [encoding, setEncoding] = useState<Encoding>("UTF-8");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [rowMode, setRowMode] = useState<RowMode>("single");

  // Page 2 state
  // const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [parsedData, setParsedData] = useState<ParsedCase[]>([]);
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);

  // Page 3 state
  const [folderSplitMode, setFolderSplitMode] =
    useState<FolderSplitMode>("plain");

  // Page 4 state
  const [previewIndex, setPreviewIndex] = useState(0);

  // Validation errors state
  const [validationErrors, setValidationErrors] =
    useState<Page1ValidationErrors>({});

  // Fetch data
  const { data: templates } = useFindManyTemplates({
    where: {
      isDeleted: false,
      isEnabled: true,
      projects: {
        some: {
          projectId: projectId,
        },
      },
    },
    include: {
      caseFields: {
        include: {
          caseField: {
            include: {
              type: true,
            },
          },
        },
        orderBy: { order: "asc" },
      },
    },
  });

  const { data: folders } = useFindManyRepositoryFolders({
    where: { projectId, isDeleted: false },
    orderBy: { order: "asc" },
  });

  // Get template fields for mapping
  const selectedTemplate = templates?.find(
    (t) => t.id.toString() === selectedTemplateId
  );
  const templateFields = useMemo(() => {
    if (!selectedTemplate) return [];

    const fields = selectedTemplate.caseFields.map((cf) => ({
      id: cf.caseField.systemName,
      displayName: cf.caseField.displayName,
      isRequired: cf.caseField.isRequired,
      type: cf.caseField.type.type,
    }));

    // Add system fields - Name is always required
    if (!fields.some((f) => f.id === "name")) {
      fields.unshift({
        id: "name",
        displayName: tGlobal("common.name"),
        isRequired: true,
        type: "Text String",
      });
    }

    // Add system fields if they don't already exist in the template
    const systemFields = [
      {
        id: "estimate",
        displayName: tCommon("fields.estimate"),
        isRequired: false,
        type: "Integer",
      },
      {
        id: "forecast",
        displayName: tCommon("fields.forecast"),
        isRequired: false,
        type: "Integer",
      },
      {
        id: "automated",
        displayName: tCommon("fields.automated"),
        isRequired: false,
        type: "Checkbox",
      },
      {
        id: "tags",
        displayName: tCommon("fields.tags"),
        isRequired: false,
        type: "Tags",
      },
      {
        id: "steps",
        displayName: tCommon("fields.steps"),
        isRequired: false,
        type: "Steps",
      },
      {
        id: "attachments",
        displayName: tCommon("fields.attachments"),
        isRequired: false,
        type: "Attachments",
      },
      {
        id: "issues",
        displayName: tCommon("fields.issues"),
        isRequired: false,
        type: "Issues",
      },
      {
        id: "linkedCases",
        displayName: tGlobal("repository.fields.linkedCases"),
        isRequired: false,
        type: "LinkedCases",
      },
      {
        id: "workflowState",
        displayName: tGlobal(
          "repository.cases.importWizard.fields.workflowState"
        ),
        isRequired: false,
        type: "WorkflowState",
      },
      {
        id: "createdAt",
        displayName: tCommon("fields.createdAt"),
        isRequired: false,
        type: "DateTime",
      },
      {
        id: "createdBy",
        displayName: tCommon("fields.createdBy"),
        isRequired: false,
        type: "User",
      },
      {
        id: "version",
        displayName: tCommon("fields.version"),
        isRequired: false,
        type: "Integer",
      },
      {
        id: "testRuns",
        displayName: tCommon("fields.testRuns"),
        isRequired: false,
        type: "TestRuns",
      },
      {
        id: "id",
        displayName: tCommon("fields.id"),
        isRequired: false,
        type: "ID",
      },
    ];

    // Only add system fields that don't already exist in template fields
    systemFields.forEach((systemField) => {
      if (!fields.some((f) => f.id === systemField.id)) {
        fields.push(systemField);
      }
    });

    // Add folder field if needed
    if (importLocation !== "single_folder") {
      fields.unshift({
        id: "folder",
        displayName: tCommon("fields.folder"),
        isRequired: true,
        type: "Text String",
      });
    }

    return fields;
  }, [selectedTemplate, importLocation, tGlobal, tCommon]);

  // Parse CSV file
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target?.result as string;

    Papa.parse(text, {
      delimiter,
      header: hasHeaders,
      encoding,
      skipEmptyLines: true,
      complete: (results) => {
        let columnHeaders: string[] = [];

        if (hasHeaders) {
          columnHeaders = results.meta.fields || [];
          setParsedData(results.data as ParsedCase[]);
        } else {
          const firstRow = results.data[0] as string[];
          columnHeaders = firstRow.map((_, i) => `Column ${i + 1}`);
          setParsedData(
            results.data.map((row: any) => {
              const obj: ParsedCase = {};
              columnHeaders.forEach((h, i) => {
                obj[h] = row[i];
              });
              return obj;
            })
          );
        }

        // Initialize field mappings with automatic matching
        const usedFields = new Set<string>();
        const mappings = columnHeaders.map((col: string) => {
          // Try to auto-map columns based on name matching
          let matchedField: string | null = null;

          if (hasHeaders) {
            const normalizedColName = col.toLowerCase().trim();

            // Skip template column - template is already selected on page 1
            if (
              normalizedColName === "template" ||
              normalizedColName === "templatename" ||
              normalizedColName === "template name"
            ) {
              return {
                csvColumn: col,
                templateField: null,
              };
            }

            // Try to find exact match first
            const exactMatch = templateFields.find(
              (field) =>
                !usedFields.has(field.id) &&
                (field.displayName.toLowerCase() === normalizedColName ||
                  field.id.toLowerCase() === normalizedColName)
            );

            if (exactMatch) {
              matchedField = exactMatch.id;
              usedFields.add(exactMatch.id);
            } else {
              // Try common variations
              const commonMappings: Record<string, string> = {
                "case name": "name",
                "test case name": "name",
                title: "name",
                tag: "tags",
                step: "steps",
                "test steps": "steps",
                estimated: "estimate",
                estimation: "estimate",
                "is automated": "automated",
                automation: "automated",
                "folder path": "folder",
                path: "folder",
                attachment: "attachments",
                issue: "issues",
                "linked case": "linkedCases",
                "linked test case": "linkedCases",
                "workflow state": "workflowState",
                state: "workflowState",
                status: "workflowState",
                "created at": "createdAt",
                "created date": "createdAt",
                "creation date": "createdAt",
                "date created": "createdAt",
                "created by": "createdBy",
                creator: "createdBy",
                author: "createdBy",
                "created user": "createdBy",
                version: "version",
                "version number": "version",
                "case version": "version",
                revision: "version",
                "test runs": "testRuns",
                "test run": "testRuns",
                runs: "testRuns",
                executions: "testRuns",
                id: "id",
                "test case id": "id",
                "case id": "id",
                identifier: "id",
              };

              // Check if column name matches any common mapping
              for (const [commonName, fieldId] of Object.entries(
                commonMappings
              )) {
                if (
                  normalizedColName === commonName ||
                  normalizedColName.includes(commonName)
                ) {
                  const field = templateFields.find(
                    (f) => f.id === fieldId && !usedFields.has(f.id)
                  );
                  if (field) {
                    matchedField = fieldId;
                    usedFields.add(fieldId);
                    break;
                  }
                }
              }

              // If still no match, try partial matching
              if (!matchedField) {
                const partialMatch = templateFields.find(
                  (field) =>
                    !usedFields.has(field.id) &&
                    (normalizedColName.includes(
                      field.displayName.toLowerCase()
                    ) ||
                      normalizedColName.includes(field.id.toLowerCase()) ||
                      field.displayName
                        .toLowerCase()
                        .includes(normalizedColName) ||
                      field.id.toLowerCase().includes(normalizedColName))
                );

                if (partialMatch) {
                  matchedField = partialMatch.id;
                  usedFields.add(partialMatch.id);
                }
              }
            }
          }

          return {
            csvColumn: col,
            templateField: matchedField,
          };
        });
        setFieldMappings(mappings);
      },
      error: (error: any) => {
        toast({
          title: tGlobal("sharedSteps.importWizard.errors.parseFailed"),
          description: error.message,
          variant: "destructive",
        });
      },
    });
  };
  if (selectedFile) {
    reader.readAsText(selectedFile, encoding);
  }

  const handleFileSelect = (files: File[]) => {
    if (files.length > 0) {
      setSelectedFile(files[0]);
      // Clear file validation error when file is selected
      if (validationErrors.selectedFile) {
        setValidationErrors((prev) => ({ ...prev, selectedFile: undefined }));
      }
    } else {
      // Files array is empty, user removed the file
      setSelectedFile(null);
    }
  };

  const handleFieldMappingChange = (
    csvColumn: string,
    templateField: string | null
  ) => {
    setFieldMappings((prev) =>
      prev.map((m) => (m.csvColumn === csvColumn ? { ...m, templateField } : m))
    );
  };

  const getMappedFields = () => {
    return fieldMappings.filter((m) => m.templateField !== null);
  };

  const getUnmappedRequiredFields = () => {
    const mappedFieldIds = fieldMappings
      .filter((m) => m.templateField !== null)
      .map((m) => m.templateField);

    return templateFields.filter(
      (f) => f.isRequired && !mappedFieldIds.includes(f.id)
    );
  };

  const canProceedToPage3 = () => {
    return getUnmappedRequiredFields().length === 0;
  };

  const getAvailableFields = (currentMapping: FieldMapping) => {
    const usedFields = fieldMappings
      .filter(
        (m) =>
          m.csvColumn !== currentMapping.csvColumn && m.templateField !== null
      )
      .map((m) => m.templateField);

    return templateFields.filter((f) => !usedFields.includes(f.id));
  };

  const getPreviewData = () => {
    if (parsedData.length === 0) return [];

    const startIndex = Math.max(
      0,
      Math.min(previewIndex * 25, parsedData.length - 25)
    );
    const endIndex = Math.min(startIndex + 25, parsedData.length);

    return parsedData.slice(startIndex, endIndex);
  };

  const validatePage1 = () => {
    const page1Schema = createPage1Schema(t, tGlobal);
    const result = page1Schema.safeParse({
      selectedFile,
      selectedTemplateId,
      selectedFolderId,
      importLocation,
    });

    if (!result.success) {
      const errors: Page1ValidationErrors = {};
      result.error.issues.forEach((issue) => {
        const path = issue.path[0] as keyof Page1ValidationErrors;
        errors[path] = issue.message;
      });
      setValidationErrors(errors);
      return false;
    }

    setValidationErrors({});
    return true;
  };

  const handleImport = async () => {
    setIsImporting(true);
    setImportProgress(0);

    try {
      const response = await fetch(`/api/repository/import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId,
          file: await selectedFile?.text(),
          delimiter,
          hasHeaders,
          encoding,
          templateId: parseInt(selectedTemplateId),
          importLocation,
          folderId: selectedFolderId ? parseInt(selectedFolderId) : null,
          fieldMappings: getMappedFields(),
          folderSplitMode:
            importLocation !== "single_folder" ? folderSplitMode : null,
          rowMode,
        }),
      });

      // Handle SSE stream
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error("Failed to get response stream");
      }

      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.error) {
                // Handle error
                if (data.errors && data.errors.length > 0) {
                  toast({
                    title: tGlobal(
                      "sharedSteps.importWizard.errors.validationFailed"
                    ),
                    description: tGlobal(
                      "sharedSteps.importWizard.errors.validationDescription",
                      {
                        count: data.errors.length,
                      }
                    ),
                    variant: "destructive",
                  });
                } else {
                  throw new Error(
                    data.error ||
                      tGlobal("sharedSteps.importWizard.errors.importFailed")
                  );
                }
                return;
              }

              if (data.complete) {
                // Import completed
                toast({
                  title: tCommon("fields.title"),
                  description: tCommon("fields.description", {
                    count: data.importedCount,
                  }),
                });

                setOpen(false);
                onImportComplete?.();
                return;
              }

              // Progress update
              if (data.imported !== undefined) {
                setImportProgress(data.imported);
              }
            } catch (parseError) {
              console.error("Failed to parse SSE data:", parseError);
            }
          }
        }
      }
    } catch (error) {
      toast({
        title: tGlobal("sharedSteps.importWizard.errors.importFailed"),
        description:
          error instanceof Error ? error.message : tCommon("errors.unknown"),
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
      setImportProgress(0);
    }
  };

  const RequiredLabel = ({
    children,
    required = false,
    error,
  }: {
    children: React.ReactNode;
    required?: boolean;
    error?: string;
  }) => (
    <div>
      <Label className={error ? "text-destructive" : ""}>
        {children}
        {required && <span className="text-destructive ml-1">{"*"}</span>}
      </Label>
      {error && <p className="text-destructive text-sm mt-1">{error}</p>}
    </div>
  );

  const renderPage1 = () => (
    <div className="space-y-6">
      <div>
        <RequiredLabel required error={validationErrors.selectedFile}>
          {tGlobal("sharedSteps.importWizard.page1.uploadFile")}
        </RequiredLabel>
        <div className="mt-2">
          <div
            className={
              validationErrors.selectedFile
                ? "border border-destructive rounded-lg p-2"
                : ""
            }
          >
            <UploadAttachments
              onFileSelect={handleFileSelect}
              compact
              previews={false}
              accept=".csv"
              allowedTypes={[".csv", "text/csv"]}
            />
          </div>
          {selectedFile && (
            <p
              className="mt-2 text-sm text-muted-foreground"
              data-testid="selected-file-info"
            >
              {tGlobal("sharedSteps.importWizard.page1.selectedFile")}:{" "}
              {selectedFile.name}
            </p>
          )}
        </div>
      </div>

      <div>
        <Label>{t("importWizard.page1.importLocation.label")}</Label>
        <RadioGroup
          value={importLocation}
          onValueChange={(v) => setImportLocation(v as ImportLocation)}
          className="mt-2"
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="single_folder" id="single_folder" />
            <Label
              htmlFor="single_folder"
              className="font-normal cursor-pointer"
            >
              {t("importWizard.page1.importLocation.singleFolder")}
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="root_folder" id="root_folder" />
            <Label htmlFor="root_folder" className="font-normal cursor-pointer">
              {t("importWizard.page1.importLocation.rootFolder")}
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="top_level" id="top_level" />
            <Label htmlFor="top_level" className="font-normal cursor-pointer">
              {t("importWizard.page1.importLocation.topLevel")}
            </Label>
          </div>
        </RadioGroup>
      </div>

      {(importLocation === "single_folder" ||
        importLocation === "root_folder") && (
        <div>
          <RequiredLabel required error={validationErrors.selectedFolderId}>
            {t("importWizard.page1.selectFolder")}
          </RequiredLabel>
          <div className="mt-2">
            <div
              className={
                validationErrors.selectedFolderId
                  ? "border border-destructive rounded-lg"
                  : ""
              }
            >
              <FolderSelect
                value={selectedFolderId}
                onChange={(value) => {
                  const stringValue = String(value || "");
                  setSelectedFolderId(stringValue);
                  // Clear folder validation error when folder is selected
                  if (validationErrors.selectedFolderId && stringValue) {
                    setValidationErrors((prev) => ({
                      ...prev,
                      selectedFolderId: undefined,
                    }));
                  }
                }}
                folders={transformFolders(folders || [])}
                placeholder={t("importWizard.page1.selectFolderPlaceholder")}
              />
            </div>
          </div>
        </div>
      )}

      <div>
        <Label>{tGlobal("sharedSteps.importWizard.page1.delimiter")}</Label>
        <Select
          value={delimiter}
          onValueChange={(v) => setDelimiter(v as Delimiter)}
        >
          <SelectTrigger className="mt-2">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value=",">
              {tGlobal("repository.exportModal.delimiter.comma")}
            </SelectItem>
            <SelectItem value=";">
              {tGlobal("repository.exportModal.delimiter.semicolon")}
            </SelectItem>
            <SelectItem value=":">
              {tGlobal("repository.exportModal.delimiter.colon")}
            </SelectItem>
            <SelectItem value="|">
              {tGlobal("repository.exportModal.delimiter.pipe")}
            </SelectItem>
            <SelectItem value="\t">
              {t("importWizard.page1.delimiters.tab")}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center space-x-2">
        <Checkbox
          id="hasHeaders"
          checked={hasHeaders}
          onCheckedChange={(c) => setHasHeaders(!!c)}
        />
        <Label htmlFor="hasHeaders" className="font-normal cursor-pointer">
          {t("importWizard.page1.hasHeaders")}
        </Label>
      </div>

      <div>
        <Label>{tGlobal("sharedSteps.importWizard.page1.encoding")}</Label>
        <Select
          value={encoding}
          onValueChange={(v) => setEncoding(v as Encoding)}
        >
          <SelectTrigger className="mt-2">
            <SelectValue placeholder="Select encoding..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="UTF-8">{"UTF-8"}</SelectItem>
            <SelectItem value="ISO-8859-1">{"ISO-8859-1"}</SelectItem>
            <SelectItem value="ISO-8859-15">{"ISO-8859-15"}</SelectItem>
            <SelectItem value="Windows-1252">{"Windows-1252"}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <RequiredLabel required error={validationErrors.selectedTemplateId}>
          {t("importWizard.page1.template")}
        </RequiredLabel>
        <Select
          value={selectedTemplateId}
          onValueChange={(value) => {
            setSelectedTemplateId(value);
            // Clear template validation error when template is selected
            if (validationErrors.selectedTemplateId && value) {
              setValidationErrors((prev) => ({
                ...prev,
                selectedTemplateId: undefined,
              }));
            }
          }}
        >
          <SelectTrigger
            className={`mt-2 ${validationErrors.selectedTemplateId ? "border-destructive" : ""}`}
            data-testid="template-select"
          >
            <SelectValue placeholder="Select a template..." />
          </SelectTrigger>
          <SelectContent>
            {templates?.map((template) => (
              <SelectItem key={template.id} value={template.id.toString()}>
                {template.templateName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label>{tGlobal("sharedSteps.importWizard.page1.rowMode.label")}</Label>
        <RadioGroup
          value={rowMode}
          onValueChange={(v) => setRowMode(v as RowMode)}
          className="mt-2"
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="single" id="row_single" />
            <Label htmlFor="row_single" className="font-normal cursor-pointer">
              {t("importWizard.page1.rowMode.single")}
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="multi" id="row_multi" />
            <Label htmlFor="row_multi" className="font-normal cursor-pointer">
              {t("importWizard.page1.rowMode.multi")}
            </Label>
          </div>
        </RadioGroup>
      </div>
    </div>
  );

  const renderPage2 = () => (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("importWizard.page2.description")}
      </p>

      {getUnmappedRequiredFields().length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {t("importWizard.page2.requiredFieldsWarning", {
              count: getUnmappedRequiredFields().length,
            })}
          </AlertDescription>
        </Alert>
      )}

      <ScrollArea className="h-[400px] border rounded-lg">
        <div className="p-4 space-y-4">
          {fieldMappings.map((mapping) => (
            <div
              key={mapping.csvColumn}
              className="grid grid-cols-2 gap-4 items-center"
            >
              <div className="font-medium">{mapping.csvColumn}</div>
              <Select
                value={mapping.templateField || "ignore"}
                onValueChange={(value) =>
                  handleFieldMappingChange(
                    mapping.csvColumn,
                    value === "ignore" ? null : value
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ignore">
                    {t("importWizard.page2.ignoreColumn")}
                  </SelectItem>
                  <Separator />
                  {getAvailableFields(mapping).map((field) => (
                    <SelectItem key={field.id} value={field.id}>
                      {field.displayName}
                      {field.isRequired && (
                        <Badge variant="secondary" className="ml-2">
                          {tCommon("fields.required")}
                        </Badge>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );

  const renderPage3 = () => {
    const hasFolderMapping = getMappedFields().some(
      (m) => m.templateField === "folder"
    );

    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("importWizard.page3.mappingSummary")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {getMappedFields().map((mapping) => {
                const field = templateFields.find(
                  (f) => f.id === mapping.templateField
                );
                return (
                  <div
                    key={mapping.csvColumn}
                    className="grid grid-cols-[1fr_auto_1fr] gap-4 items-center"
                  >
                    <span className="font-medium">{mapping.csvColumn}</span>
                    <span className="text-muted-foreground">{"→"}</span>
                    <span className="text-right">{field?.displayName}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {hasFolderMapping && (
          <div>
            <Label>{t("importWizard.page3.folderSplitMode.label")}</Label>
            <RadioGroup
              value={folderSplitMode}
              onValueChange={(v) => setFolderSplitMode(v as FolderSplitMode)}
              className="mt-2 space-y-4"
            >
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="plain" id="split_plain" />
                  <Label
                    htmlFor="split_plain"
                    className="font-normal cursor-pointer"
                  >
                    {t("importWizard.page3.folderSplitMode.plain")}
                  </Label>
                </div>
                <p className="text-sm text-muted-foreground ml-6">
                  {t("importWizard.page3.folderSplitMode.plainExample")}
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="slash" id="split_slash" />
                  <Label
                    htmlFor="split_slash"
                    className="font-normal cursor-pointer"
                  >
                    {t("importWizard.page3.folderSplitMode.slash")}
                  </Label>
                </div>
                <p className="text-sm text-muted-foreground ml-6">
                  {t("importWizard.page3.folderSplitMode.slashExample")}
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="dot" id="split_dot" />
                  <Label
                    htmlFor="split_dot"
                    className="font-normal cursor-pointer"
                  >
                    {t("importWizard.page3.folderSplitMode.dot")}
                  </Label>
                </div>
                <p className="text-sm text-muted-foreground ml-6">
                  {t("importWizard.page3.folderSplitMode.dotExample")}
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="greater_than" id="split_greater" />
                  <Label
                    htmlFor="split_greater"
                    className="font-normal cursor-pointer"
                  >
                    {t("importWizard.page3.folderSplitMode.greaterThan")}
                  </Label>
                </div>
                <p className="text-sm text-muted-foreground ml-6">
                  {t("importWizard.page3.folderSplitMode.greaterThanExample")}
                </p>
              </div>
            </RadioGroup>
          </div>
        )}
      </div>
    );
  };

  const renderPage4 = () => {
    const previewData = getPreviewData();
    const mappedFields = getMappedFields();

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {t("importWizard.page4.showing", {
              start: previewIndex * 25 + 1,
              end: Math.min((previewIndex + 1) * 25, parsedData.length),
              total: parsedData.length,
            })}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPreviewIndex(Math.max(0, previewIndex - 1))}
              disabled={previewIndex === 0}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPreviewIndex(previewIndex + 1)}
              disabled={(previewIndex + 1) * 25 >= parsedData.length}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <ScrollArea className="h-[400px] border rounded-lg">
          <div className="p-4 space-y-4">
            {previewData.map((caseData, index) => (
              <Card key={index}>
                <CardHeader>
                  <CardTitle className="text-sm">
                    {t("importWizard.page4.case", {
                      number: previewIndex * 25 + index + 1,
                    })}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {mappedFields.map((mapping) => {
                      const field = templateFields.find(
                        (f) => f.id === mapping.templateField
                      );
                      const value = caseData[mapping.csvColumn];

                      return (
                        <div
                          key={mapping.csvColumn}
                          className="grid grid-cols-2 gap-2 text-sm"
                        >
                          <span className="font-medium">
                            {field?.displayName}:
                          </span>
                          <span className="truncate">
                            {value ||
                              tGlobal("sharedSteps.importWizard.page3.noValue")}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      </div>
    );
  };

  const canProceedToNextPage = () => {
    // Always return true to keep the button enabled
    return true;
  };

  const handleNextPage = () => {
    if (currentPage === 1) {
      if (validatePage1()) {
        setCurrentPage(currentPage + 1);
      }
    } else if (currentPage === 2) {
      if (canProceedToPage3()) {
        setCurrentPage(currentPage + 1);
      }
    } else {
      setCurrentPage(currentPage + 1);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Download className="h-4 w-4" />
          {t("importWizard.title")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("importWizard.title")}</DialogTitle>
          <DialogDescription>
            {currentPage === 1 &&
              tGlobal("sharedSteps.importWizard.page1.title")}
            {currentPage === 2 && t("importWizard.page2.title")}
            {currentPage === 3 && t("importWizard.page3.title")}
            {currentPage === 4 && t("importWizard.page4.title")}
          </DialogDescription>
        </DialogHeader>

        {/* Progress indicator */}
        <div className="flex items-center gap-2 mb-4 shrink-0">
          {[1, 2, 3, 4].map((step) => (
            <div key={step} className="flex items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  step < currentPage
                    ? "bg-primary text-primary-foreground"
                    : step === currentPage
                      ? "bg-primary/10 text-primary border-2 border-primary"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {step < currentPage ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  step
                )}
              </div>
              {step < 4 && (
                <div
                  className={`w-12 h-0.5 mx-2 ${
                    step < currentPage ? "bg-primary" : "bg-muted"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {isImporting && (
            <LoadingSpinnerAlert
              message={tGlobal("repository.generateTestCases.importing", {
                count: parsedData.length - importProgress,
              })}
            />
          )}
          {currentPage === 1 && renderPage1()}
          {currentPage === 2 && renderPage2()}
          {currentPage === 3 && renderPage3()}
          {currentPage === 4 && renderPage4()}
        </div>

        <DialogFooter className="shrink-0">
          {currentPage > 1 && (
            <Button
              variant="outline"
              onClick={() => setCurrentPage(currentPage - 1)}
              disabled={isImporting}
            >
              <ChevronLeft className="h-4 w-4" />
              {tCommon("actions.previous")}
            </Button>
          )}

          {currentPage < 4 ? (
            <Button onClick={handleNextPage} data-testid="next-button">
              {tCommon("actions.next")}
              <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              onClick={handleImport}
              disabled={isImporting}
              data-testid="import-button"
            >
              {isImporting
                ? tGlobal("repository.generateTestCases.importing", {
                    count: parsedData.length - importProgress,
                  })
                : tGlobal("repository.generateTestCases.import", {
                    count: parsedData.length,
                  })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
