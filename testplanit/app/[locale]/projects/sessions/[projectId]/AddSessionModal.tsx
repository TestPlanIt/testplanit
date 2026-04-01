import { AttachmentsCarousel } from "@/components/AttachmentsCarousel";
import DynamicIcon from "@/components/DynamicIcon";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import {
  MilestoneSelect,
  transformMilestones,
} from "@/components/forms/MilestoneSelect";
import { UnifiedIssueManager } from "@/components/issues/UnifiedIssueManager";
import { ManageTags } from "@/components/ManageTags";
import { UserNameCell } from "@/components/tables/UserNameCell";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { HelpPopover } from "@/components/ui/help-popover";
import { Input } from "@/components/ui/input";
import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import UploadAttachments from "@/components/UploadAttachments";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Attachments } from "@prisma/client";
import { ApplicationArea } from "@prisma/client";
import { AlertTriangle, Asterisk, CirclePlus, Combine, LayoutList } from "lucide-react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import parseDuration from "parse-duration";
import React, { useCallback, useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod/v4";
import { notifySessionAssignment } from "~/app/actions/session-notifications";
import { searchConfigurations } from "~/app/actions/searchConfigurations";
import { searchProjectMembers } from "~/app/actions/searchProjectMembers";
import { emptyEditorContent, MAX_DURATION } from "~/app/constants";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import {
  useCreateAttachments,
  useCreateSessions,
  useCreateSessionVersions,
  useFindFirstProjects,
  useFindManyIssue,
  useFindManyMilestones,
  useFindManyTags,
  useFindManyTemplates,
  useFindManyWorkflows,
} from "~/lib/hooks";
import { IconName } from "~/types/globals";
import { toHumanReadable } from "~/utils/duration";
import { fetchSignedUrl } from "~/utils/fetchSignedUrl";

interface ConfigurationOption {
  id: number;
  name: string;
}

export interface SessionDuplicationPreset {
  originalName: string;
  originalConfigId: number | null;
  originalConfigName: string | null;
  originalMilestoneId: number | null;
  originalStateId: number | null;
  originalAssignedToId: string | null;
  originalTemplateId: number;
  originalEstimate: number | null;
  originalNote?: any;
  originalMission?: any;
  originalTagIds: number[];
  originalIssueIds: number[];
  originalFieldValues: { fieldId: number; value: any }[];
}

interface AddSessionModalProps {
  defaultMilestoneId?: number;
  trigger?: React.ReactNode; // Optional custom trigger
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  duplicationPreset?: SessionDuplicationPreset | null;
}

export function AddSessionModal({
  defaultMilestoneId,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  duplicationPreset,
}: AddSessionModalProps) {
  const { data: session } = useSession();
  const { projectId } = useParams();
  const numericProjectId = Number(projectId);
  const t = useTranslations();
  const locale = useLocale();

  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: createSessions } = useCreateSessions();
  const { mutateAsync: createSessionVersions } = useCreateSessionVersions();
  const { mutateAsync: createAttachments } = useCreateAttachments();

  const { data: project } = useFindFirstProjects({
    where: {
      id: Number(projectId),
    },
    select: {
      name: true,
      projectIntegrations: {
        where: { isActive: true },
        include: { integration: true },
      },
    },
  });

  const { data: allIssues } = useFindManyIssue(
    {
      where: {
        // Filter by projectId
        projectId: Number(projectId),
        isDeleted: false,
      },
      select: { id: true, name: true, externalId: true },
    },
    {
      enabled: Boolean(project?.projectIntegrations?.[0]),
    }
  );

  const { data: templates } = useFindManyTemplates({
    where: {
      isDeleted: false,
      isEnabled: true,
      projects: {
        some: {
          projectId: Number(projectId),
        },
      },
    },
    orderBy: {
      templateName: "asc",
    },
  });

  const { data: workflows } = useFindManyWorkflows({
    where: {
      isDeleted: false,
      isEnabled: true,
      scope: "SESSIONS",
      projects: {
        some: {
          projectId: Number(projectId),
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

  const { data: milestones } = useFindManyMilestones({
    where: {
      projectId: Number(projectId),
      isDeleted: false,
      isCompleted: false,
    },
    include: {
      milestoneType: { include: { icon: true } },
    },
    orderBy: [{ startedAt: "asc" }, { isStarted: "asc" }],
  });

  const { data: tags } = useFindManyTags({
    where: {
      isDeleted: false,
    },
    orderBy: {
      name: "asc",
    },
  });

  const defaultTemplate = templates?.find((template) => template.isDefault);
  const defaultWorkflow = workflows?.find((workflow) => workflow.isDefault);

  const templatesOptions =
    templates?.map((template) => ({
      value: template.id.toString(),
      label: template.templateName,
    })) || [];

  const workflowsOptions =
    workflows?.map((workflow) => ({
      value: workflow.id.toString(),
      label: workflow.name,
      icon: workflow.icon?.name,
      color: workflow.color?.value,
    })) || [];

  const milestonesOptions = transformMilestones(milestones || []);

  const handleCancel = () => setOpen(false);

  type JsonArray = any[];
  type JsonObject = any;

  const [missionContent, setMissionContent] = useState<
    | string
    | number
    | boolean
    | JsonObject
    | JsonArray
    | { type: string; content: any }
    | null
  >(null);

  const [noteContent, setNoteContent] = useState<object>({});

  const _handleUpdate = useCallback((newContent: object) => {
    setMissionContent(newContent);
  }, []);

  const FormSchema = z.object({
    name: z.string().min(2, {
      message: t("common.validation.nameMinLength"),
    }),
    templateId: z.number(),
    configIds: z.array(z.number()),
    milestoneId: z.number().nullable(),
    stateId: z.number(),
    assignedToId: z.string().optional(),
    estimate: z
      .string()
      .nullable()
      .refine(
        (value) => {
          if (!value) return true;
          return parseDuration(value) !== null;
        },
        {
          message: t("common.validation.invalidDurationFormat"),
        }
      )
      .refine(
        (value) => {
          if (!value) return true;
          const durationInMilliseconds = parseDuration(value);
          if (!durationInMilliseconds) return false;
          const durationInSeconds = Math.round(durationInMilliseconds / 1000);
          return durationInSeconds <= MAX_DURATION;
        },
        {
          message: `Estimate must be less than or equal to ${toHumanReadable(
            MAX_DURATION,
            {
              isSeconds: true,
              locale,
            }
          )}.`,
        }
      ),
    note: z.any().nullable(),
    mission: z.any().optional(),
    attachments: z.array(z.any()).optional(),
    issueIds: z.array(z.number()).optional(),
  });

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: duplicationPreset
        ? `${duplicationPreset.originalName} - ${t("common.actions.duplicate")}`
        : "",
      templateId: duplicationPreset?.originalTemplateId || defaultTemplate?.id || 0,
      configIds: duplicationPreset?.originalConfigId
        ? [duplicationPreset.originalConfigId]
        : [],
      milestoneId: duplicationPreset?.originalMilestoneId ?? defaultMilestoneId ?? null,
      stateId: duplicationPreset?.originalStateId || defaultWorkflow?.id || 0,
      assignedToId: duplicationPreset?.originalAssignedToId || "",
      estimate: "",
      note: null,
      mission: null,
      attachments: [],
      issueIds: duplicationPreset?.originalIssueIds || [],
    },
  });

  const {
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = form;

  const [linkedIssueIds, setLinkedIssueIds] = useState<number[]>([]);

  useEffect(() => {
    if (defaultTemplate && defaultWorkflow && !duplicationPreset) {
      reset({
        name: "",
        templateId: defaultTemplate.id,
        configIds: [],
        stateId: defaultWorkflow.id,
        assignedToId: "",
        estimate: "",
        note: null,
        mission: null,
        milestoneId: defaultMilestoneId ?? null,
        attachments: [],
        issueIds: [],
      });
      setLinkedIssueIds([]);
      setMissionContent(null);
      setNoteContent({});
      setSelectedTags([]);
      setSelectedConfigs([]);
      setSelectedFiles([]);
    }
  }, [defaultTemplate, defaultWorkflow, reset, defaultMilestoneId, duplicationPreset]);

  useEffect(() => {
    if (open) {
      const initialTemplateId =
        duplicationPreset?.originalTemplateId ||
        defaultTemplate?.id || (templates && templates[0]?.id) || 0;
      const initialWorkflowId =
        duplicationPreset?.originalStateId ||
        defaultWorkflow?.id || (workflows && workflows[0]?.id) || 0;

      reset({
        name: duplicationPreset
          ? `${duplicationPreset.originalName} - ${t("common.actions.duplicate")}`
          : "",
        templateId: initialTemplateId,
        configIds: duplicationPreset?.originalConfigId
          ? [duplicationPreset.originalConfigId]
          : [],
        stateId: initialWorkflowId,
        assignedToId: duplicationPreset?.originalAssignedToId || "",
        estimate: "",
        note: null,
        mission: null,
        milestoneId: duplicationPreset?.originalMilestoneId ?? defaultMilestoneId ?? null,
        attachments: [],
        issueIds: duplicationPreset?.originalIssueIds || [],
      });
      setLinkedIssueIds(duplicationPreset?.originalIssueIds || []);
      if (duplicationPreset?.originalNote) {
        try {
          const parsed = typeof duplicationPreset.originalNote === "string"
            ? JSON.parse(duplicationPreset.originalNote)
            : duplicationPreset.originalNote;
          setNoteContent(parsed);
        } catch {
          setNoteContent({});
        }
      } else {
        setNoteContent({});
      }
      if (duplicationPreset?.originalMission) {
        try {
          const parsed = typeof duplicationPreset.originalMission === "string"
            ? JSON.parse(duplicationPreset.originalMission)
            : duplicationPreset.originalMission;
          setMissionContent(parsed);
        } catch {
          setMissionContent(null);
        }
      } else {
        setMissionContent(null);
      }
      setSelectedTags(duplicationPreset?.originalTagIds || []);
      setSelectedConfigs(
        duplicationPreset?.originalConfigId && duplicationPreset?.originalConfigName
          ? [{ id: duplicationPreset.originalConfigId, name: duplicationPreset.originalConfigName }]
          : []
      );
      setSelectedFiles([]);
    }
  }, [
    open,
    reset,
    defaultTemplate,
    defaultWorkflow,
    defaultMilestoneId,
    templates,
    workflows,
    duplicationPreset,
    t,
  ]);

  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const [selectedConfigs, setSelectedConfigs] = useState<ConfigurationOption[]>([]);

  const userName = session?.user?.name || t("common.labels.unknownUser");

  const [selectedAttachmentIndex, setSelectedAttachmentIndex] = useState<
    number | null
  >(null);
  const [selectedAttachments, setSelectedAttachments] = useState<Attachments[]>(
    []
  );

  const _handleSelect = (attachments: Attachments[], index: number) => {
    setSelectedAttachments(attachments);
    setSelectedAttachmentIndex(index);
  };

  const handleClose = () => {
    setSelectedAttachmentIndex(null);
    setSelectedAttachments([]);
  };

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  const handleFileSelect = (files: File[]) => {
    setSelectedFiles(files);
  };

  const uploadFiles = async (sessionId: number) => {
    const prependString = session!.user.id;
    const sanitizedFolder = projectId?.toString() || "";

    const attachmentsPromises = selectedFiles.map(async (file) => {
      const fileUrl = await fetchSignedUrl(
        file,
        `/api/get-attachment-url/`,
        `${sanitizedFolder}/${prependString}`
      );

      const attachment = await createAttachments({
        data: {
          session: {
            connect: { id: sessionId },
          },
          url: fileUrl,
          name: file.name,
          note: "",
          mimeType: file.type,
          size: BigInt(file.size),
          createdBy: {
            connect: { id: session!.user.id },
          },
        },
      });

      return {
        id: attachment?.id || 0,
        testCaseId: null,
        sessionId: sessionId,
        url: fileUrl,
        name: file.name,
        note: "",
        isDeleted: false,
        mimeType: file.type,
        size: attachment?.size.toString(),
        createdAt: new Date().toISOString(),
        createdById: session!.user.id,
      };
    });

    const attachments = await Promise.all(attachmentsPromises);
    return attachments;
  };

  // --- Fetch Permissions ---
  const { permissions: tagsPermissions } = useProjectPermissions(
    numericProjectId,
    ApplicationArea.Tags
  );
  const canAddEditTags = tagsPermissions?.canAddEdit ?? false;
  const isSuperAdmin = session?.user?.access === "ADMIN";
  const showAddEditTagsPerm = canAddEditTags || isSuperAdmin;

  if (!session || !session.user.access) {
    return null;
  }

  async function onSubmit(data: z.infer<typeof FormSchema>) {
    setIsSubmitting(true);
    try {
      if (!session?.user?.id) {
        throw new Error(t("common.errors.noUserSession"));
      }

      if (!projectId) {
        throw new Error(t("common.errors.noProjectId"));
      }

      const estimateInSeconds = data.estimate
        ? Math.round(parseDuration(data.estimate) || 0) / 1000
        : null;

      // Determine configs to create sessions for
      const configsToCreate = data.configIds.length > 0 ? data.configIds : [null];
      const configurationGroupId = configsToCreate.length > 1 ? uuidv4() : null;

      const issuesDataForVersion = (linkedIssueIds || [])
        .map((issueId: number) => {
          const issue = allIssues?.find((iss) => iss.id === issueId);
          return issue
            ? { id: issue.id, name: issue.name, externalId: issue.externalId }
            : null;
        })
        .filter(Boolean);

      const createdSessions: any[] = [];

      for (const configId of configsToCreate) {
        const newSession = await createSessions({
          data: {
            project: {
              connect: { id: Number(projectId) },
            },
            template: {
              connect: { id: data.templateId || defaultTemplate?.id },
            },
            name: data.name,
            currentVersion: 1,
            configurationGroupId,
            configuration: configId
              ? { connect: { id: configId } }
              : undefined,
            milestone: data.milestoneId
              ? { connect: { id: data.milestoneId } }
              : undefined,
            state: {
              connect: { id: data.stateId },
            },
            assignedTo: data.assignedToId
              ? { connect: { id: data.assignedToId } }
              : undefined,
            estimate: estimateInSeconds,
            note: noteContent
              ? JSON.stringify(noteContent)
              : JSON.stringify(emptyEditorContent),
            mission: missionContent
              ? JSON.stringify(missionContent)
              : JSON.stringify(emptyEditorContent),
            createdAt: new Date(),
            createdBy: {
              connect: { id: session.user.id },
            },
            tags: {
              connect: selectedTags.map((tagId) => ({ id: tagId })),
            },
            issues: linkedIssueIds?.length
              ? {
                  connect: linkedIssueIds.map((id) => ({ id })),
                }
              : undefined,
          },
        });

        if (!newSession) throw new Error(t("sessions.errors.failedToCreate"));

        // Only upload files to the first session
        const uploadedAttachments =
          createdSessions.length === 0 && selectedFiles.length > 0
            ? await uploadFiles(newSession.id)
            : [];

        const newSessionVersion = await createSessionVersions({
          data: {
            session: {
              connect: { id: newSession.id },
            },
            name: data.name,
            staticProjectId: Number(projectId),
            staticProjectName: project?.name || t("common.labels.unknownProject"),
            project: {
              connect: { id: Number(projectId!) },
            },
            templateId: data.templateId,
            templateName:
              templates?.find((template) => template.id === data.templateId)
                ?.templateName || "",
            configId: configId || null,
            configurationName: null,
            milestoneId: data.milestoneId || null,
            milestoneName:
              milestones?.find((m) => m.id === data.milestoneId)?.name || null,
            stateId: data.stateId,
            stateName:
              workflows?.find((workflow) => workflow.id === data.stateId)?.name ||
              "",
            assignedToId: data.assignedToId || null,
            assignedToName: null,
            createdById: session.user.id,
            createdByName: userName,
            estimate: estimateInSeconds,
            forecastManual: null,
            forecastAutomated: null,
            note: noteContent
              ? JSON.stringify(noteContent)
              : JSON.stringify(emptyEditorContent),
            mission: missionContent
              ? JSON.stringify(missionContent)
              : JSON.stringify(emptyEditorContent),
            isCompleted: false,
            completedAt: null,
            version: 1,
            tags: JSON.stringify(
              selectedTags.map((tagId) => ({
                id: tagId,
                name:
                  tags?.find((tag) => tag.id === tagId)?.name ||
                  t("common.labels.unknownTag"),
              })) || []
            ),
            attachments: JSON.stringify(uploadedAttachments),
            issues: JSON.stringify(issuesDataForVersion),
          },
        });

        if (!newSessionVersion)
          throw new Error(t("sessions.errors.failedToCreateVersion"));

        // Copy custom field values from duplication preset
        if (duplicationPreset?.originalFieldValues?.length) {
          for (const fv of duplicationPreset.originalFieldValues) {
            try {
              await fetch(`/api/model/sessionFieldValues`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  data: {
                    session: { connect: { id: newSession.id } },
                    field: { connect: { id: fv.fieldId } },
                    value: fv.value,
                  },
                }),
              });
            } catch {
              // Non-critical: continue if field value copy fails
            }
          }
        }

        // Send notification if session was assigned during creation
        if (data.assignedToId) {
          await notifySessionAssignment(newSession.id, data.assignedToId, null);
        }

        createdSessions.push(newSession);
      }

      setOpen(false);
      setIsSubmitting(false);
      const sessionsCreated = createdSessions.length;
      if (sessionsCreated > 1) {
        toast.success(t("sessions.messages.createSuccessMultiple", { count: sessionsCreated }));
      } else {
        toast.success(t("sessions.messages.createSuccess"));
      }
      if (typeof window !== "undefined") {
        // Fire event for the first created session (scroll into view)
        const event = new CustomEvent("sessionCreated", {
          detail: createdSessions[0]?.id,
        });
        window.dispatchEvent(event);
      }
    } catch (err: any) {
      if (err.info?.prisma && err.info?.code === "P2002") {
        form.setError("name", {
          type: "custom",
          message: t("sessions.errors.nameAlreadyExists"),
        });
      } else {
        form.setError("root", {
          type: "custom",
          message: t("common.errors.unknownErrorWithMessage", {
            message: err.message,
          }),
        });
      }
      setIsSubmitting(false);
      toast.error(t("sessions.errors.createFailed"));
      return;
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!controlledOpen && (trigger ? (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : (
        <DialogTrigger asChild>
          <Button variant="outline" size="icon">
            <CirclePlus className="h-5 w-5" />
          </Button>
        </DialogTrigger>
      ))}
      {selectedAttachmentIndex !== null && (
        <AttachmentsCarousel
          attachments={selectedAttachments}
          initialIndex={selectedAttachmentIndex}
          onClose={handleClose}
          canEdit={false} // TODO: Add canEdit
        />
      )}
      <DialogContent className="sm:max-w-[600px] lg:max-w-[1000px]">
        <Form {...form}>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>
                {duplicationPreset
                  ? t("sessions.duplicateDialog.title")
                  : t("sessions.actions.add")}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {duplicationPreset
                  ? t("sessions.duplicateDialog.title")
                  : t("sessions.actions.add")}
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-[60%_5%_35%] gap-x-4">
              <div className="space-y-4">
                <FormField
                  control={control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {t("common.name")}
                        <sup>
                          <Asterisk className="w-3 h-3 text-destructive" />
                        </sup>
                        <HelpPopover helpKey="session.name" />
                      </FormLabel>
                      <FormControl>
                        <Input placeholder={t("common.name")} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={control}
                  name="note"
                  render={({ field: _field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {t("common.fields.description")}
                        <HelpPopover helpKey="session.description" />
                      </FormLabel>
                      <FormControl>
                        <TipTapEditor
                          key={`editing-note-${duplicationPreset ? "dup" : "new"}`}
                          content={noteContent && Object.keys(noteContent).length > 0 ? noteContent : emptyEditorContent}
                          onUpdate={(newContent) => {
                            setNoteContent(newContent);
                          }}
                          readOnly={false}
                          className="h-auto max-h-[150px]"
                          placeholder={t(
                            "common.fields.description_placeholder"
                          )}
                          projectId={projectId!.toString()}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={control}
                  name="mission"
                  render={({ field: _field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {t("common.fields.mission")}
                        <HelpPopover helpKey="session.mission" />
                      </FormLabel>
                      <FormControl>
                        <TipTapEditor
                          key="editing-mission"
                          content={missionContent || emptyEditorContent}
                          onUpdate={(newContent) => {
                            setMissionContent(newContent);
                          }}
                          readOnly={false}
                          className="h-auto"
                          placeholder={t("common.placeholders.mission")}
                          projectId={projectId?.toString() || ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={control}
                  name="configIds"
                  render={({ field }) => {
                    const clearAllConfigurations = () => {
                      field.onChange([]);
                      setSelectedConfigs([]);
                    };

                    return (
                      <FormItem>
                        <FormLabel className="flex justify-between items-center">
                          <div className="flex items-center">
                            {t("common.fields.configurations")}
                            {selectedConfigs.length > 0 && (
                              <span className="ml-1 text-muted-foreground">
                                {"("}
                                {selectedConfigs.length}
                                {")"}
                              </span>
                            )}
                            <HelpPopover helpKey="session.configuration" />
                          </div>
                          {selectedConfigs.length > 0 && (
                            <span
                              onClick={clearAllConfigurations}
                              className="cursor-pointer text-sm text-muted-foreground hover:underline"
                            >
                              {t("common.actions.clearAll")}
                            </span>
                          )}
                        </FormLabel>
                        <FormControl>
                          <MultiAsyncCombobox<ConfigurationOption>
                            value={selectedConfigs}
                            hideSelected={true}
                            onValueChange={(configs) => {
                              setSelectedConfigs(configs);
                              field.onChange(configs.map((c) => c.id));
                            }}
                            fetchOptions={searchConfigurations}
                            renderOption={(config) => (
                              <div className="flex items-center gap-2">
                                <Combine className="w-4 h-4" />
                                {config.name}
                              </div>
                            )}
                            renderSelectedOption={(config) => (
                              <span className="flex items-center gap-1 min-w-0">
                                <Combine className="w-3 h-3 shrink-0" />
                                <span className="truncate">{config.name}</span>
                              </span>
                            )}
                            getOptionValue={(config) => config.id}
                            getOptionLabel={(config) => config.name}
                            placeholder={t("common.placeholders.selectConfigurations")}
                            showTotal
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    );
                  }}
                />
                <FormField
                  control={control}
                  name="attachments"
                  render={({ field: _field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {t("common.fields.attachments")}
                        <HelpPopover helpKey="session.attachments" />
                      </FormLabel>
                      <FormControl>
                        <div className="space-y-4">
                          <UploadAttachments onFileSelect={handleFileSelect} />
                          {selectedFiles.length > 0 && (
                            <div className="mt-2 text-sm text-muted-foreground">
                              {t("common.labels.filesSelectedForUpload", {
                                count: selectedFiles.length,
                              })}
                            </div>
                          )}
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="flex items-center justify-center">
                <Separator orientation="vertical" className="h-full" />
              </div>
              <div className="space-y-4 mr-6 max-w-[265px]">
                <FormField
                  control={control}
                  name="templateId"
                  render={({ field: _field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {t("common.fields.template")}
                        <sup>
                          <Asterisk className="w-3 h-3 text-destructive" />
                        </sup>
                        <HelpPopover helpKey="session.template" />
                      </FormLabel>
                      <FormControl>
                        <Controller
                          control={control}
                          name="templateId"
                          render={({ field: { onChange, value } }) => (
                            <Select
                              onValueChange={(val) => onChange(Number(val))}
                              value={value ? value.toString() : ""}
                            >
                              <SelectTrigger>
                                <SelectValue
                                  placeholder={t(
                                    "common.placeholders.selectTemplate"
                                  )}
                                />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectGroup>
                                  {templatesOptions.map((template) => (
                                    <SelectItem
                                      key={template.value}
                                      value={template.value}
                                    >
                                      <div className="flex items-center gap-1">
                                        <LayoutList className="w-4 h-4" />
                                        {template.label}
                                      </div>
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={control}
                  name="stateId"
                  render={({ field: _field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {t("common.fields.state")}
                        <sup>
                          <Asterisk className="w-3 h-3 text-destructive" />
                        </sup>
                        <HelpPopover helpKey="session.state" />
                      </FormLabel>
                      <FormControl>
                        <Controller
                          control={control}
                          name="stateId"
                          render={({ field: { onChange, value } }) => (
                            <Select
                              onValueChange={(val) => onChange(Number(val))}
                              value={value ? value.toString() : ""}
                            >
                              <SelectTrigger>
                                <SelectValue
                                  placeholder={t(
                                    "common.placeholders.selectState"
                                  )}
                                />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectGroup>
                                  {workflowsOptions.map((workflow) => (
                                    <SelectItem
                                      key={workflow.value}
                                      value={workflow.value}
                                    >
                                      <div className="flex items-center gap-1">
                                        <DynamicIcon
                                          className="w-4 h-4 shrink-0"
                                          name={workflow.icon as IconName}
                                          color={workflow.color}
                                        />
                                        {workflow.label}
                                      </div>
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={control}
                  name="milestoneId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {t("common.fields.milestone")}
                        <HelpPopover helpKey="session.milestone" />
                      </FormLabel>
                      <FormControl>
                        <MilestoneSelect
                          value={field.value}
                          onChange={(value) => {
                            const numericValue = value ? Number(value) : null;
                            field.onChange(numericValue);
                          }}
                          milestones={milestonesOptions}
                          placeholder={t("common.access.none")}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={control}
                  name="assignedToId"
                  render={({ field: _field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {t("common.fields.assignedTo")}
                        <HelpPopover helpKey="session.assignedTo" />
                      </FormLabel>
                      <FormControl>
                        <Controller
                          control={control}
                          name="assignedToId"
                          render={({ field: { onChange, value } }) => (
                            <AsyncCombobox
                              value={
                                value
                                  ? {
                                      id: value,
                                      name: value,
                                      email: null as string | null,
                                      image: null as string | null,
                                    }
                                  : null
                              }
                              onValueChange={(user) => {
                                onChange(user ? user.id : null);
                              }}
                              fetchOptions={(query, page, pageSize) =>
                                searchProjectMembers(
                                  Number(projectId),
                                  query,
                                  page,
                                  pageSize
                                )
                              }
                              renderOption={(user) => (
                                <UserNameCell userId={user.id} hideLink />
                              )}
                              getOptionValue={(user) => user.id}
                              placeholder={t(
                                "sessions.placeholders.selectUser"
                              )}
                              className="w-full"
                              pageSize={20}
                              showTotal={true}
                              showUnassigned={true}
                            />
                          )}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={control}
                  name="estimate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {t("common.fields.estimate")}
                        <HelpPopover helpKey="session.estimate" />
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="text"
                          placeholder={t("sessions.placeholders.estimate")}
                          {...field}
                          value={field.value || ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div>
                  <FormLabel className="flex items-center mb-2">
                    {t("common.fields.tags")}
                    <HelpPopover helpKey="session.tags" />
                  </FormLabel>
                  <ManageTags
                    selectedTags={selectedTags}
                    setSelectedTags={setSelectedTags}
                    canCreateTags={showAddEditTagsPerm}
                  />
                </div>
                {project?.projectIntegrations?.[0] ? (
                  <FormItem>
                    <FormLabel className="flex items-center">
                      {t("common.fields.issues")}
                      <HelpPopover helpKey="session.issues" />
                    </FormLabel>
                    <UnifiedIssueManager
                      projectId={Number(projectId)}
                      linkedIssueIds={linkedIssueIds}
                      setLinkedIssueIds={setLinkedIssueIds}
                      entityType="session"
                    />
                    <FormMessage />
                  </FormItem>
                ) : (
                  <div className="text-sm text-muted-foreground flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    {t("common.errors.issueTrackerNotConfigured")}
                  </div>
                )}
              </div>
            </div>

            <DialogFooter>
              {errors.root && (
                <div
                  className="w-full text-center bg-destructive text-destructive-foreground text-sm p-2 rounded"
                  role="alert"
                >
                  {errors.root.message}
                </div>
              )}
              <Button variant="outline" type="button" onClick={handleCancel}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? t("common.actions.submitting")
                  : selectedConfigs.length > 1
                    ? `${t("common.actions.create")} (${selectedConfigs.length})`
                    : t("common.actions.create")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
