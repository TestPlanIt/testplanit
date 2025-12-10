import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
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
  SelectGroup,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import UploadAttachments from "./UploadAttachments";
import {
  useFindManyConfigurations,
  useFindManyMilestones,
  useFindManyTags,
  useFindManyTemplates,
  useFindManyWorkflows,
} from "~/lib/hooks";
import { ManageTags } from "./ManageTags";
import { useToast } from "@/components/ui/use-toast";
import { Input } from "@/components/ui/input";
import {
  ConfigurationSelect,
  transformConfigurations,
} from "./forms/ConfigurationSelect";
import { MilestoneSelect, transformMilestones } from "./forms/MilestoneSelect";
import DynamicIcon from "@/components/DynamicIcon";
import { IconName } from "~/types/globals";
import { FolderSelect, transformFolders } from "./forms/FolderSelect";
import { useFindManyRepositoryFolders } from "~/lib/hooks/repository-folders";
import { Asterisk } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";

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

interface TestResultsImportDialogProps {
  projectId: number;
  onSuccess?: () => void;
  defaultFormat?: TestResultFormat;
}

export default function TestResultsImportDialog({
  projectId,
  onSuccess,
  defaultFormat = "auto",
}: TestResultsImportDialogProps) {
  const t = useTranslations("common.actions.testResults.import");
  const tCommon = useTranslations("common");
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<TestResultFormat>(defaultFormat);
  const [stateId, setStateId] = useState<string>("");
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importStatus, setImportStatus] = useState<string>("");

  // Fetch configurations, milestones, tags, workflows
  const { data: configurations } = useFindManyConfigurations({
    where: { isDeleted: false, isEnabled: true },
    orderBy: { name: "asc" },
  });
  const { data: milestones } = useFindManyMilestones({
    where: { projectId, isDeleted: false, isCompleted: false },
    orderBy: { startedAt: "asc" },
    include: {
      milestoneType: { include: { icon: true } },
    },
  });
  useFindManyTags({
    where: { isDeleted: false },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const { data: workflows } = useFindManyWorkflows({
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
    useFindManyRepositoryFolders({
      where: {
        projectId,
        isDeleted: false,
      },
      orderBy: { order: "asc" },
    });

  // Fetch templates for the project
  const { data: templates } = useFindManyTemplates({
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
    resolver: zodResolver(TestResultsImportSchema),
    defaultValues: {
      name: "",
      selectedFolderId: "",
      stateId: "",
      templateId: "",
      selectedFiles: [] as File[],
      configurationId: "",
      milestoneId: "",
      selectedTags: [] as number[],
    },
  });

  const { handleSubmit, control } = form;

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
      if (data.configurationId)
        formData.append("configId", data.configurationId);
      if (data.milestoneId) formData.append("milestoneId", data.milestoneId);
      if (data.selectedFolderId)
        formData.append("parentFolderId", data.selectedFolderId);
      (data.selectedTags ?? []).forEach((id) =>
        formData.append("tagIds", id.toString())
      );
      data.selectedFiles.forEach((file) => formData.append("files", file));

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
                if (
                  e instanceof Error &&
                  e.message !== "Failed to import test results"
                ) {
                  console.error("Error parsing SSE data:", e);
                } else {
                  throw e;
                }
              }
            }
          }
        }
      }

      toast({
        title: t("success.title"),
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
      toast({
        title: t("error.title"),
        description:
          error instanceof Error ? error.message : t("error.importFailed"),
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
      setImportProgress(0);
      setImportStatus("");
    }
  });

  // Set default workflow state and template when dialog opens
  React.useEffect(() => {
    if (open && defaultWorkflow && !stateId) {
      setStateId(defaultWorkflow.id.toString());
      form.setValue("stateId", defaultWorkflow.id.toString());
    }
    if (open && defaultTemplate && !form.getValues("templateId")) {
      form.setValue("templateId", defaultTemplate.id.toString());
    }
  }, [open, defaultWorkflow, stateId, defaultTemplate, form]);

  // Get accepted file extensions based on format
  const acceptedExtensions =
    TEST_RESULT_FORMATS.find((f) => f.value === format)?.extensions || ".xml";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">{t("trigger")}</Button>
      </DialogTrigger>
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
                  {t("format.label")}
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
                    <SelectValue placeholder={t("format.placeholder")} />
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
                          folders={transformFolders(folders || [])}
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
                          value={field.value ? field.value : null}
                          onChange={(val) =>
                            field.onChange(val ? val.toString() : "")
                          }
                          configurations={transformConfigurations(
                            configurations || []
                          )}
                          isLoading={!configurations}
                          disabled={isImporting}
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
                                    <span className="ml-2 text-xs text-muted-foreground">
                                      {tCommon("fields.default")}
                                    </span>
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
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={isImporting}>
                {isImporting ? t("importing") : t("import")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
