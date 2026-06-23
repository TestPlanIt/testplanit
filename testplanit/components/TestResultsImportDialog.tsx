/* eslint-disable react-hooks/incompatible-library -- This file consumes a library API (TanStack Table / TanStack Virtual / react-hook-form watch) that returns unstable function references by design; React Compiler auto-skips memoization here and the lint rule reports it. */

import DynamicIcon from "@/components/DynamicIcon";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Asterisk, Star } from "lucide-react";
import { useTranslations } from "next-intl";
import React, { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod/v4";
import { IconName } from "~/types/globals";
import { ConfigurationSelect } from "./forms/ConfigurationSelect";
import { FolderSelect, transformFolders } from "./forms/FolderSelect";
import { MilestoneSelect, transformMilestones } from "./forms/MilestoneSelect";
import { ManageTags } from "./ManageTags";
import UploadAttachments from "./UploadAttachments";

/**
 * Supported test result formats
 */
const TEST_RESULT_FORMATS = [
  { value: "auto", label: "Auto-detect", extensions: ".xml,.trx,.json" },
  { value: "junit", label: "JUnit XML", extensions: ".xml" },
  { value: "testng", label: "TestNG XML", extensions: ".xml" },
  { value: "xunit", label: "xUnit XML", extensions: ".xml" },
  { value: "nunit", label: "NUnit XML", extensions: ".xml" },
  { value: "mstest", label: "MSTest TRX", extensions: ".trx,.xml" },
  { value: "mocha", label: "Mocha JSON", extensions: ".json" },
  { value: "cucumber", label: "Cucumber JSON", extensions: ".json" },
] as const;

type TestResultFormat = (typeof TEST_RESULT_FORMATS)[number]["value"];

/**
 * Case-ID matching options. Values mirror the import endpoint's accepted
 * `caseMatcher` / `caseIdFormat` form fields.
 */
type CaseMatcher = "off" | "name" | "property" | "auto";
type CaseIdFormat = "brackets" | "c" | "tc";

const NEW_FOLDER_SENTINEL = "__new__";

interface TestResultsImportDialogProps {
  projectId: number;
  onSuccess?: () => void;
  defaultFormat?: TestResultFormat;
  open: boolean;
  onClose: () => void;
  initialFiles?: File[];
}

export default function TestResultsImportDialog({
  projectId,
  onSuccess,
  defaultFormat = "auto",
  open,
  onClose,
  initialFiles,
}: TestResultsImportDialogProps) {
  const t = useTranslations("common.actions.junit.import");
  const tFormat = useTranslations("common.actions.testResults.import.format");
  const tCommon = useTranslations("common");

  const setOpen = (v: boolean) => {
    if (!v) onClose();
  };
  const [format, setFormat] = useState<TestResultFormat>(defaultFormat);
  const [caseMatcher, setCaseMatcher] = useState<CaseMatcher>("off");
  const [caseIdFormat, setCaseIdFormat] = useState<CaseIdFormat>("brackets");
  const [stateId, setStateId] = useState<string>("");
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importStatus, setImportStatus] = useState<string>("");

  // Fetch milestones, tags, workflows
  const { data: milestones } = useClientQueries(schema).milestones.useFindMany({
    where: { projectId, isDeleted: false, isCompleted: false },
    orderBy: { startedAt: "asc" },
    include: {
      milestoneType: { include: { icon: true } },
    },
  });
  useClientQueries(schema).tags.useFindMany({
    where: { isDeleted: false },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const { data: workflows } = useClientQueries(schema).workflows.useFindMany({
    where: {
      isDeleted: false,
      isEnabled: true,
      scope: "RUNS",
      projects: {
        some: {
          projectId: projectId,
        },
      },
    },
    include: {
      icon: true,
      color: true,
    },
    orderBy: {
      order: "asc",
    },
  });

  // Fetch folders for the project
  const { data: folders, isLoading: isFoldersLoading } =
    useClientQueries(schema).repositoryFolders.useFindMany({
      where: {
        projectId,
        isDeleted: false,
      },
      orderBy: { order: "asc" },
    });

  // Fetch templates for the project
  const { data: templates } = useClientQueries(schema).templates.useFindMany({
    where: {
      isDeleted: false,
      projects: {
        some: {
          projectId: projectId,
        },
      },
    },
    orderBy: {
      templateName: "asc",
    },
  });

  const defaultTemplate = templates?.find((template) => template.isDefault);
  const defaultWorkflow = workflows?.find((workflow) => workflow.isDefault);
  const workflowsOptions =
    workflows?.map((workflow) => ({
      value: workflow.id.toString(),
      label: workflow.name,
      icon: workflow.icon?.name,
      color: workflow.color?.value,
    })) || [];

  // Zod schema for required fields
  const TestResultsImportSchema = z.object({
    name: z
      .string()
      .min(
        1,
        tCommon("validation.required", { field: tCommon("labels.testRunName") })
      ),
    selectedFolderId: z
      .string()
      .min(1, tCommon("validation.required", { field: "Folder" })),
    stateId: z
      .string()
      .min(
        1,
        tCommon("validation.required", { field: tCommon("fields.state") })
      ),
    templateId: z
      .string()
      .min(
        1,
        tCommon("validation.required", { field: tCommon("fields.template") })
      ),
    selectedFiles: z.array(z.instanceof(File)).min(1, t("fileRequired")),
    configurationId: z.string().optional(),
    milestoneId: z.string().optional(),
    selectedTags: z.array(z.number()).optional(),
  });

  const form = useForm({
    resolver: standardSchemaResolver(TestResultsImportSchema),
    defaultValues: {
      name: "",
      selectedFolderId: NEW_FOLDER_SENTINEL,
      stateId: "",
      templateId: "",
      selectedFiles: [] as File[],
      configurationId: "",
      milestoneId: "",
      selectedTags: [] as number[],
    },
  });

  const { handleSubmit, control, watch } = form;
  const watchedName = watch("name");

  // Seed form with initialFiles when dialog opens externally
  useEffect(() => {
    if (open && initialFiles && initialFiles.length > 0) {
      form.setValue("selectedFiles", initialFiles);
      if (!form.getValues("name")) {
        const fileName = initialFiles[0].name.replace(/\.[^.]+$/, "");
        form.setValue("name", fileName);
      }
    }
  }, [open, initialFiles, form]);

  const handleImport = handleSubmit(async (data) => {
    try {
      setIsImporting(true);
      setImportProgress(0);
      setImportStatus(t("progress.initializing"));

      // Create form data for the request
      const formData = new FormData();
      formData.append("name", data.name);
      formData.append("projectId", projectId.toString());
      formData.append("stateId", data.stateId.toString());
      formData.append("templateId", data.templateId.toString());
      formData.append("format", format);
      // Only send case-ID matching config when enabled, so the default
      // (off) leaves import behavior unchanged.
      if (caseMatcher !== "off") {
        formData.append("caseMatcher", caseMatcher);
        formData.append("caseIdFormat", caseIdFormat);
      }
      if (data.configurationId)
        formData.append("configId", data.configurationId);
      if (data.milestoneId) formData.append("milestoneId", data.milestoneId);
      if (data.selectedFolderId === NEW_FOLDER_SENTINEL) {
        formData.append("newFolderName", data.name);
      } else if (data.selectedFolderId) {
        formData.append("parentFolderId", data.selectedFolderId);
      }
      (data.selectedTags ?? []).forEach((id: number) =>
        formData.append("tagIds", id.toString())
      );
      data.selectedFiles.forEach((file: File) =>
        formData.append("files", file)
      );

      const response = await fetch("/api/test-results/import", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to import test results");
      }

      // Read the streamed response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.trim() && line.startsWith("data: ")) {
              try {
                const eventData = JSON.parse(line.slice(6));
                if (eventData.progress !== undefined) {
                  setImportProgress(eventData.progress);
                }
                if (eventData.status) {
                  setImportStatus(eventData.status);
                }
                if (eventData.error) {
                  throw new Error(eventData.error);
                }
                if (eventData.complete) {
                  setImportProgress(100);
                  setImportStatus(t("progress.completed"));
                }
              } catch (e) {
                if (e instanceof SyntaxError) {
                  // JSON parse error on SSE data — log and continue
                  console.error("Error parsing SSE data:", e);
                } else {
                  throw e;
                }
              }
            }
          }
        }
      }

      toast.success(t("success.title"), {
        description: t("success.description"),
      });

      // Wait a moment to show completion
      await new Promise((resolve) => setTimeout(resolve, 500));

      setOpen(false);
      form.reset();
      setStateId("");
      setSelectedTags([]);
      setImportProgress(0);
      setImportStatus("");
      onSuccess?.();
    } catch (error) {
      console.error("Error importing test results:", error);
      toast.error(t("error.title"), {
        description:
          error instanceof Error ? error.message : t("error.importFailed"),
      });
    } finally {
      setIsImporting(false);
      setImportProgress(0);
      setImportStatus("");
    }
  });

  // Set default workflow state, template, and folder when dialog opens
  React.useEffect(() => {
    if (open && defaultWorkflow && !stateId) {
      setStateId(defaultWorkflow.id.toString());
      form.setValue("stateId", defaultWorkflow.id.toString());
    }
    if (open && defaultTemplate && !form.getValues("templateId")) {
      form.setValue("templateId", defaultTemplate.id.toString());
    }
    if (open && !form.getValues("selectedFolderId")) {
      form.setValue("selectedFolderId", NEW_FOLDER_SENTINEL);
    }
  }, [open, defaultWorkflow, stateId, defaultTemplate, form]);

  // Get accepted file extensions based on format
  const acceptedExtensions =
    TEST_RESULT_FORMATS.find((f) => f.value === format)?.extensions || ".xml";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={handleImport} className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              {/* Test Run Name */}
              <div className="grid gap-2 col-span-2">
                <FormField
                  control={control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor="name" className="flex items-center">
                        {tCommon("labels.testRunName")}
                        <sup>
                          <Asterisk className="w-3 h-3 text-destructive" />
                        </sup>
                      </FormLabel>
                      <FormControl>
                        <Input
                          id="name"
                          type="text"
                          {...field}
                          disabled={isImporting}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Format selector */}
              <div className="grid gap-2">
                <Label htmlFor="format" className="flex items-center">
                  {tFormat("label")}
                  <sup>
                    <Asterisk className="w-3 h-3 text-destructive" />
                  </sup>
                </Label>
                <Select
                  value={format}
                  onValueChange={(val) => setFormat(val as TestResultFormat)}
                  disabled={isImporting}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={tFormat("placeholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {TEST_RESULT_FORMATS.map((fmt) => (
                        <SelectItem key={fmt.value} value={fmt.value}>
                          {fmt.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              {/* Case matching */}
              <div className="grid gap-2">
                <Label htmlFor="caseMatcher">{t("caseMatching.label")}</Label>
                <Select
                  value={caseMatcher}
                  onValueChange={(val) => setCaseMatcher(val as CaseMatcher)}
                  disabled={isImporting}
                >
                  <SelectTrigger id="caseMatcher">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="off">
                        {t("caseMatching.off")}
                      </SelectItem>
                      <SelectItem value="name">
                        {t("caseMatching.name")}
                      </SelectItem>
                      <SelectItem value="property">
                        {t("caseMatching.property")}
                      </SelectItem>
                      <SelectItem value="auto">
                        {t("caseMatching.auto")}
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t("caseMatching.help")}
                </p>
              </div>

              {/* Case ID format (only when matching by the test name) */}
              {(caseMatcher === "name" || caseMatcher === "auto") && (
                <div className="grid gap-2">
                  <Label htmlFor="caseIdFormat">
                    {t("caseIdFormat.label")}
                  </Label>
                  <Select
                    value={caseIdFormat}
                    onValueChange={(val) =>
                      setCaseIdFormat(val as CaseIdFormat)
                    }
                    disabled={isImporting}
                  >
                    <SelectTrigger id="caseIdFormat">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="brackets">
                          {t("caseIdFormat.brackets")}
                        </SelectItem>
                        <SelectItem value="c">{t("caseIdFormat.c")}</SelectItem>
                        <SelectItem value="tc">
                          {t("caseIdFormat.tc")}
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Folder (required) */}
              <div className="grid gap-2">
                <FormField
                  control={control}
                  name="selectedFolderId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor="folder" className="flex items-center">
                        {tCommon("fields.parentFolder")}
                        <sup>
                          <Asterisk className="w-3 h-3 text-destructive" />
                        </sup>
                      </FormLabel>
                      <FormControl>
                        <FolderSelect
                          value={field.value}
                          onChange={(val) =>
                            field.onChange(val ? String(val) : "")
                          }
                          folders={[
                            {
                              value: NEW_FOLDER_SENTINEL,
                              label: watchedName
                                ? t("createNewFolderNamed", {
                                    name: watchedName,
                                  })
                                : t("createNewFolder"),
                              parentId: null,
                            },
                            ...transformFolders(folders || []),
                          ]}
                          isLoading={isFoldersLoading}
                          placeholder={t("selectFolder")}
                          disabled={isImporting}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Configuration */}
              <div className="grid gap-2">
                <FormField
                  control={control}
                  name="configurationId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor="configuration">
                        {tCommon("fields.configuration")}
                      </FormLabel>
                      <FormControl>
                        <ConfigurationSelect
                          value={field.value ? Number(field.value) : null}
                          onChange={(val) =>
                            field.onChange(val ? val.toString() : "")
                          }
                          disabled={isImporting}
                          projectId={projectId}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* State */}
              <div className="grid gap-2">
                <FormField
                  control={control}
                  name="stateId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor="state" className="flex items-center">
                        {tCommon("fields.state")}
                        <sup>
                          <Asterisk className="w-3 h-3 text-destructive" />
                        </sup>
                      </FormLabel>
                      <FormControl>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                          disabled={isImporting}
                        >
                          <SelectTrigger>
                            <SelectValue
                              placeholder={tCommon("placeholders.selectState")}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {workflowsOptions.map((option) => (
                                <SelectItem
                                  key={option.value}
                                  value={option.value}
                                >
                                  <div className="flex items-center gap-2">
                                    {option.icon && (
                                      <DynamicIcon
                                        name={option.icon as IconName}
                                        className="h-4 w-4"
                                        style={{ color: option.color }}
                                      />
                                    )}
                                    {option.label}
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Template */}
              <div className="grid gap-2">
                <FormField
                  control={control}
                  name="templateId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel
                        htmlFor="template"
                        className="flex items-center"
                      >
                        {tCommon("fields.template")}
                        <sup>
                          <Asterisk className="w-3 h-3 text-destructive" />
                        </sup>
                      </FormLabel>
                      <FormControl>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                          disabled={isImporting}
                        >
                          <SelectTrigger>
                            <SelectValue
                              placeholder={tCommon(
                                "placeholders.selectTemplate"
                              )}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {templates?.map((template) => (
                                <SelectItem
                                  key={template.id}
                                  value={template.id.toString()}
                                >
                                  {template.templateName}
                                  {template.isDefault && (
                                    <Tooltip>
                                      <TooltipTrigger className="ml-1" asChild>
                                        <Badge variant="secondary">
                                          <Star className="h-3 w-3 fill-current text-primary-background" />
                                        </Badge>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        {tCommon("defaultOption")}
                                      </TooltipContent>
                                    </Tooltip>
                                  )}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Milestone */}
              <div className="grid gap-2">
                <FormField
                  control={control}
                  name="milestoneId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor="milestone">
                        {tCommon("fields.milestone")}
                      </FormLabel>
                      <FormControl>
                        <MilestoneSelect
                          value={field.value ? field.value : null}
                          onChange={(val) =>
                            field.onChange(val ? val.toString() : "")
                          }
                          milestones={transformMilestones(milestones || [])}
                          isLoading={!milestones}
                          disabled={isImporting}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Tags */}
              <div className="grid gap-2 col-span-2">
                <Label>{tCommon("fields.tags")}</Label>
                <ManageTags
                  selectedTags={selectedTags}
                  setSelectedTags={(tags) => {
                    setSelectedTags(tags);
                    form.setValue("selectedTags", tags);
                  }}
                  canCreateTags={true}
                />
              </div>

              {/* File upload (full width) */}
              <div className="col-span-2 grid gap-2">
                <FormField
                  control={control}
                  name="selectedFiles"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {t("file.label")}
                        <sup>
                          <Asterisk className="w-3 h-3 text-destructive" />
                        </sup>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {`(${acceptedExtensions})`}
                        </span>
                      </FormLabel>
                      <FormControl>
                        <UploadAttachments
                          onFileSelect={(files) => field.onChange(files)}
                          compact={true}
                          previews={false}
                          disabled={isImporting}
                          initialFiles={initialFiles}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Progress indicator */}
            {isImporting && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{importStatus}</span>
                  <span className="text-muted-foreground">
                    {Math.round(importProgress)}
                    {"%"}
                  </span>
                </div>
                <Progress value={importProgress} className="w-full" />
              </div>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isImporting}
                type="button"
              >
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={isImporting}>
                {isImporting
                  ? tCommon("status.importing")
                  : tCommon("actions.junit.import.import")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
