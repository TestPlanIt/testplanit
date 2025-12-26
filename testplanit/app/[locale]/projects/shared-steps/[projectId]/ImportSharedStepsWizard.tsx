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

interface ImportSharedStepsWizardProps {
  onImportComplete?: () => void;
}

type Delimiter = "," | ";" | ":" | "|" | "\t";
type Encoding = "UTF-8" | "ISO-8859-1" | "ISO-8859-15" | "Windows-1252";
type RowMode = "single" | "multi";

interface FieldMapping {
  csvColumn: string;
  templateField: string | null;
}

interface ParsedSharedStep {
  [key: string]: any;
}

// Zod validation schema for page 1
const createPage1Schema = (t: any) =>
  z.object({
    selectedFile: z.any().refine((file) => file !== null, {
      message: t("importWizard.errors.csvFileRequired"),
    }),
  });

type Page1ValidationErrors = {
  selectedFile?: string;
};

export function ImportSharedStepsWizard({
  onImportComplete,
}: ImportSharedStepsWizardProps) {
  const t = useTranslations("sharedSteps");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const { toast } = useToast();
  const params = useParams();
  const projectId = parseInt(params.projectId as string);

  const [open, setOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [isImporting, setIsImporting] = useState(false);

  // Page 1 state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [delimiter, setDelimiter] = useState<Delimiter>(",");
  const [hasHeaders, setHasHeaders] = useState(true);
  const [encoding, setEncoding] = useState<Encoding>("UTF-8");
  const [rowMode, setRowMode] = useState<RowMode>("single");

  // Page 2 state
  const [parsedData, setParsedData] = useState<ParsedSharedStep[]>([]);
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);

  // Page 3 state
  const [previewIndex, setPreviewIndex] = useState(0);

  // Validation errors state
  const [validationErrors, setValidationErrors] =
    useState<Page1ValidationErrors>({});

  // Fields for shared steps
  const sharedStepFields = useMemo(() => {
    const fields = [
      {
        id: "groupName",
        displayName: tCommon("name"),
        isRequired: true,
        type: "Text String",
      },
      {
        id: "step",
        displayName: tCommon("fields.step"),
        isRequired: rowMode === "single" ? false : true,
        type: "Text Long",
      },
      {
        id: "expectedResult",
        displayName: tCommon("fields.expectedResult"),
        isRequired: false,
        type: "Text Long",
      },
      {
        id: "order",
        displayName: t("importWizard.fields.order"),
        isRequired: false,
        type: "Integer",
      },
      {
        id: "stepNumber",
        displayName: t("importWizard.fields.stepNumber"),
        isRequired: false,
        type: "Integer",
      },
      {
        id: "stepContent",
        displayName: t("importWizard.fields.stepContent"),
        isRequired: rowMode === "multi" ? true : false,
        type: "Text Long",
      },
      {
        id: "expectedResultContent",
        displayName: t("importWizard.fields.expectedResultContent"),
        isRequired: false,
        type: "Text Long",
      },
      {
        id: "combinedStepData",
        displayName: t("importWizard.fields.combinedStepData"),
        isRequired: rowMode === "single" ? true : false,
        type: "Steps",
      },
      {
        id: "stepsData",
        displayName: t("importWizard.fields.stepsData"),
        isRequired: rowMode === "single" ? true : false,
        type: "Steps",
      },
    ];

    return fields;
  }, [tCommon, t, rowMode]);

  // Parse CSV file
  useEffect(() => {
    if (selectedFile && currentPage === 2) {
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
              setParsedData(results.data as ParsedSharedStep[]);
            } else {
              const firstRow = results.data[0] as string[];
              columnHeaders = firstRow.map((_, i) => `Column ${i + 1}`);
              setParsedData(
                results.data.map((row: any) => {
                  const obj: ParsedSharedStep = {};
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

                // Try to find exact match first
                const exactMatch = sharedStepFields.find(
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
                    group: "groupName",
                    "group name": "groupName",
                    "shared step group": "groupName",
                    "shared step group name": "groupName",
                    step: "step",
                    "test step": "step",
                    action: "step",
                    "expected result": "expectedResult",
                    expected: "expectedResult",
                    result: "expectedResult",
                    "expected outcome": "expectedResult",
                    order: "order",
                    sequence: "order",
                    position: "order",
                    index: "order",
                    // Export format mappings
                    "step #": "stepNumber",
                    "step number": "stepNumber",
                    "step content": "stepContent",
                    "expected result content": "expectedResultContent",
                    "combined step data": "combinedStepData",
                    "steps data": "stepsData",
                    combinedstepdata: "combinedStepData",
                    stepsdata: "stepsData",
                  };

                  // Check if column name matches any common mapping
                  for (const [commonName, fieldId] of Object.entries(
                    commonMappings
                  )) {
                    if (
                      normalizedColName === commonName ||
                      normalizedColName.includes(commonName)
                    ) {
                      const field = sharedStepFields.find(
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
                    const partialMatch = sharedStepFields.find(
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
              title: t("importWizard.errors.parseFailed"),
              description: error.message,
              variant: "destructive",
            });
          },
        });
      };
      reader.readAsText(selectedFile, encoding);
    }
  }, [
    selectedFile,
    currentPage,
    delimiter,
    hasHeaders,
    encoding,
    t,
    toast,
    sharedStepFields,
  ]);

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

    return sharedStepFields.filter(
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

    return sharedStepFields.filter((f) => !usedFields.includes(f.id));
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
    const page1Schema = createPage1Schema(t);
    const result = page1Schema.safeParse({
      selectedFile,
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

    try {
      const response = await fetch(`/api/shared-steps/import`, {
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
          fieldMappings: getMappedFields(),
          rowMode,
        }),
      });

      const result = await response.json();

      if (response.ok) {
        toast({
          title: tCommon("fields.success"),
          description: t("importWizard.success.description", {
            count: result.importedCount,
          }),
        });

        setOpen(false);
        onImportComplete?.();
      } else {
        if (result.errors && result.errors.length > 0) {
          toast({
            title: t("importWizard.errors.validationFailed"),
            description: t("importWizard.errors.validationDescription", {
              count: result.errors.length,
            }),
            variant: "destructive",
          });
        } else {
          throw new Error(
            result.error || t("importWizard.errors.importFailed")
          );
        }
      }
    } catch (error) {
      toast({
        title: t("importWizard.errors.importFailed"),
        description:
          error instanceof Error ? error.message : tCommon("errors.unknown"),
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
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
          {t("importWizard.page1.uploadFile")}
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
              {t("importWizard.page1.selectedFile")}: {selectedFile.name}
            </p>
          )}
        </div>
      </div>

      <div>
        <Label>{t("importWizard.page1.delimiter")}</Label>
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
        <Label>{t("importWizard.page1.encoding")}</Label>
        <Select
          value={encoding}
          onValueChange={(v) => setEncoding(v as Encoding)}
        >
          <SelectTrigger className="mt-2">
            <SelectValue />
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
        <Label>{t("importWizard.page1.rowMode.label")}</Label>
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
    const previewData = getPreviewData();
    const mappedFields = getMappedFields();

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {t("importWizard.page3.showing", {
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
            {previewData.map((stepData, index) => (
              <Card key={index}>
                <CardHeader>
                  <CardTitle className="text-sm">
                    {t("importWizard.page3.step", {
                      number: previewIndex * 25 + index + 1,
                    })}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {mappedFields.map((mapping) => {
                      const field = sharedStepFields.find(
                        (f) => f.id === mapping.templateField
                      );
                      const value = stepData[mapping.csvColumn];

                      return (
                        <div
                          key={mapping.csvColumn}
                          className="grid grid-cols-2 gap-2 text-sm"
                        >
                          <span className="font-medium">
                            {field?.displayName}:
                          </span>
                          <span className="truncate">
                            {value || t("importWizard.page3.noValue")}
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
        <Button variant="outline" className="w-full">
          <Download className="h-4 w-4" />
          {t("importWizard.title")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("importWizard.title")}</DialogTitle>
          <DialogDescription>
            {currentPage === 1 && t("importWizard.page1.title")}
            {currentPage === 2 && t("importWizard.page2.title")}
            {currentPage === 3 && t("importWizard.page3.title")}
          </DialogDescription>
        </DialogHeader>

        {/* Progress indicator */}
        <div className="flex items-center gap-2 mb-4 shrink-0">
          {[1, 2, 3].map((step) => (
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
              {step < 3 && (
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
          {currentPage === 1 && renderPage1()}
          {currentPage === 2 && renderPage2()}
          {currentPage === 3 && renderPage3()}
        </div>

        <DialogFooter className="shrink-0">
          {currentPage > 1 && (
            <Button
              variant="outline"
              onClick={() => setCurrentPage(currentPage - 1)}
              disabled={isImporting}
            >
              <ChevronLeft className="h-4 w-4 mr-2" />
              {tCommon("actions.previous")}
            </Button>
          )}

          {currentPage < 3 ? (
            <Button onClick={handleNextPage} data-testid="next-button">
              {tCommon("actions.next")}
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          ) : (
            <Button
              onClick={handleImport}
              disabled={isImporting}
              data-testid="import-button"
            >
              {isImporting
                ? tCommon("status.importing")
                : tCommon("actions.junit.import.import")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
