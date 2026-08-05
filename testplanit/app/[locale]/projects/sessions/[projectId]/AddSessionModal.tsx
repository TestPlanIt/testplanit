import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { AttachmentsCarousel } from "@/components/AttachmentsCarousel";
import { WorkflowStateDisplay } from "@/components/WorkflowStateDisplay";
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
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
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
import UploadAttachments, {
  type LinkAttachmentInput,
} from "@/components/UploadAttachments";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import type { Attachments } from "~/zenstack/models";
import { ApplicationArea } from "~/zenstack/models";
import { AlertTriangle, Asterisk, Combine, LayoutList } from "lucide-react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import parseDuration from "parse-duration";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod/v4";
import { notifySessionAssignment } from "~/app/actions/session-notifications";
import { searchConfigurations } from "~/app/actions/searchConfigurations";
import { searchProjectMembers } from "~/app/actions/searchProjectMembers";
import { emptyEditorContent, MAX_DURATION } from "~/app/constants";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { IconName } from "~/types/globals";
import { toHumanReadable } from "~/utils/duration";
import { fetchSignedUrl } from "~/utils/fetchSignedUrl";
import { isUniqueConstraintError } from "~/lib/utils/errors";

interface ConfigurationOption {
  id: number;
  name: string;
}

export interface SessionDuplicationPreset {
  /** Source session id, persisted as duplicatedFromId so the create emits the
   * session.duplicated webhook event. */
  originalSessionId: number;
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
  open: boolean;
  onClose: () => void;
  duplicationPreset?: SessionDuplicationPreset | null;
}

export function AddSessionModal({
  defaultMilestoneId,
  open,
  onClose,
  duplicationPreset,
}: AddSessionModalProps) {
  const { data: session } = useSession();
  const { projectId } = useParams();
  const numericProjectId = Number(projectId);
  const t = useTranslations();
  const locale = useLocale();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: createSessions } =
    useClientQueries(schema).sessions.useCreate();
  const { mutateAsync: createSessionVersions } =
    useClientQueries(schema).sessionVersions.useCreate();
  const { mutateAsync: createAttachments } =
    useClientQueries(schema).attachments.useCreate();

  const { data: project } = useClientQueries(schema).projects.useFindFirst({
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

  const { data: allIssues } = useClientQueries(schema).issue.useFindMany(
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

  const { data: templates } = useClientQueries(schema).templates.useFindMany({
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

  const { data: workflows } = useClientQueries(schema).workflows.useFindMany({
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

  const { data: milestones } = useClientQueries(schema).milestones.useFindMany({
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

  const { data: tags } = useClientQueries(schema).tags.useFindMany({
    where: {
      isDeleted: false,
    },
    orderBy: {
      name: "asc",
    },
  });

  // Fall back to the first available template / workflow when nothing is
  // currently flagged as default. The seeded "Default Template" / "Draft"
  // workflow's `isDefault` flag can be flipped by the single-default
  // cascade when an admin (or a parallel E2E test) marks something else as
  // default — leaving `defaultTemplate` undefined makes the Create button
  // permanently disabled even though a perfectly usable template exists.
  const defaultTemplate =
    templates?.find((template) => template.isDefault) ?? templates?.[0];
  const defaultWorkflow =
    workflows?.find((workflow) => workflow.isDefault) ?? workflows?.[0];

  // Surface a banner in the duplicate dialog when the source session's
  // template or workflow state is no longer assigned to / enabled for the
  // project. The form silently swaps to the project's default in that case
  // (so the create won't fail with an empty templateName); the banner tells
  // the user the swap happened.
  const templatesLoaded = Array.isArray(templates);
  const workflowsLoaded = Array.isArray(workflows);
  const sourceTemplateUnassigned = Boolean(
    duplicationPreset?.originalTemplateId &&
    templatesLoaded &&
    !templates!.some(
      (template) => template.id === duplicationPreset.originalTemplateId
    )
  );
  const sourceStateUnassigned = Boolean(
    duplicationPreset?.originalStateId &&
    workflowsLoaded &&
    !workflows!.some(
      (workflow) => workflow.id === duplicationPreset.originalStateId
    )
  );

  const templatesOptions =
    templates?.map((template) => ({
      value: template.id.toString(),
      label: template.templateName,
    })) || [];

  const firstGatedSessionOrder = (workflows ?? [])
    .filter((w) => w.requiresReview === true)
    .reduce<number | null>(
      (acc, w) => (acc === null || w.order < acc ? w.order : acc),
      null
    );
  const workflowsOptions =
    workflows?.map((workflow) => ({
      value: workflow.id.toString(),
      label: workflow.name,
      icon: workflow.icon?.name,
      color: workflow.color?.value,
      requiresReview: workflow.requiresReview,
      disabledForCreate:
        firstGatedSessionOrder !== null &&
        workflow.order >= firstGatedSessionOrder,
    })) || [];

  const milestonesOptions = transformMilestones(milestones || []);

  const handleCancel = () => onClose();

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
    resolver: standardSchemaResolver(FormSchema),
    defaultValues: {
      name: duplicationPreset
        ? `${duplicationPreset.originalName} - ${t("common.actions.duplicate")}`
        : "",
      templateId:
        duplicationPreset?.originalTemplateId || defaultTemplate?.id || 0,
      configIds: duplicationPreset?.originalConfigId
        ? [duplicationPreset.originalConfigId]
        : [],
      milestoneId:
        duplicationPreset?.originalMilestoneId ?? defaultMilestoneId ?? null,
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

  // Initialize form once per dialog open. Uses a ref guard to prevent
  // re-runs when async data (templates, workflows) arrives after the user
  // has already started filling the form.
  const formInitRef = useRef(false);
  useEffect(() => {
    if (!open) {
      formInitRef.current = false;
      return;
    }
    if (formInitRef.current) return;

    // Only adopt the source session's template / workflow ID when it's
    // actually present in this project's assigned templates / workflows.
    // Sessions can carry a `templateId` that's no longer assigned to the
    // project (template unassigned, workflow disabled, project moved,
    // etc.). Carrying that stale ID through into the form means the
    // combobox shows the visible default but the submitted payload uses
    // an ID that lookup tables can't resolve — server then rejects the
    // session-version create with an empty `templateName` ZodError.
    const sourceTemplateValid =
      duplicationPreset?.originalTemplateId &&
      templates?.some((t) => t.id === duplicationPreset.originalTemplateId);
    const sourceStateValid =
      duplicationPreset?.originalStateId &&
      workflows?.some((w) => w.id === duplicationPreset.originalStateId);
    const initialTemplateId =
      (sourceTemplateValid && duplicationPreset!.originalTemplateId) ||
      defaultTemplate?.id ||
      (templates && templates[0]?.id) ||
      0;
    const initialWorkflowId =
      (sourceStateValid && duplicationPreset!.originalStateId) ||
      defaultWorkflow?.id ||
      (workflows && workflows[0]?.id) ||
      0;

    // Only mark as initialized once we have real data to set
    if (!initialTemplateId || !initialWorkflowId) return;
    formInitRef.current = true;

    // keepDirtyValues: this init can land after the user has already started
    // typing (templates/workflows arrive async) — never wipe their input.
    reset(
      {
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
        milestoneId:
          duplicationPreset?.originalMilestoneId ?? defaultMilestoneId ?? null,
        attachments: [],
        issueIds: duplicationPreset?.originalIssueIds || [],
      },
      { keepDirtyValues: true }
    );
    setLinkedIssueIds(duplicationPreset?.originalIssueIds || []);
    if (duplicationPreset?.originalNote) {
      try {
        const parsed =
          typeof duplicationPreset.originalNote === "string"
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
        const parsed =
          typeof duplicationPreset.originalMission === "string"
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
      duplicationPreset?.originalConfigId &&
        duplicationPreset?.originalConfigName
        ? [
            {
              id: duplicationPreset.originalConfigId,
              name: duplicationPreset.originalConfigName,
            },
          ]
        : []
    );
    setSelectedFiles([]);
    setSelectedLinks([]);
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
  const [selectedConfigs, setSelectedConfigs] = useState<ConfigurationOption[]>(
    []
  );

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
  const [selectedLinks, setSelectedLinks] = useState<LinkAttachmentInput[]>([]);

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

    const linkPromises = selectedLinks.map(async (link) => {
      const attachment = await createAttachments({
        data: {
          session: {
            connect: { id: sessionId },
          },
          url: link.url,
          name: link.name,
          note: link.note ?? "",
          mimeType: link.mimeType,
          size: BigInt(link.size),
          createdBy: {
            connect: { id: session!.user.id },
          },
        },
      });

      return {
        id: attachment?.id || 0,
        testCaseId: null,
        sessionId: sessionId,
        url: link.url,
        name: link.name,
        note: link.note ?? "",
        isDeleted: false,
        mimeType: link.mimeType,
        size: attachment?.size.toString(),
        createdAt: new Date().toISOString(),
        createdById: session!.user.id,
      };
    });

    const attachments = await Promise.all([
      ...attachmentsPromises,
      ...linkPromises,
    ]);
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
      const configsToCreate =
        data.configIds.length > 0 ? data.configIds : [null];
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
            // Provenance marker so the create emits session.duplicated.
            ...(duplicationPreset
              ? { duplicatedFromId: duplicationPreset.originalSessionId }
              : {}),
            ...(configId
              ? { configuration: { connect: { id: configId } } }
              : {}),
            ...(data.milestoneId
              ? { milestone: { connect: { id: data.milestoneId } } }
              : {}),
            state: {
              connect: { id: data.stateId },
            },
            ...(data.assignedToId
              ? { assignedTo: { connect: { id: data.assignedToId } } }
              : {}),
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
            ...(linkedIssueIds?.length
              ? {
                  issues: {
                    connect: linkedIssueIds.map((id) => ({ id })),
                  },
                }
              : {}),
          },
        });

        if (!newSession) throw new Error(t("sessions.errors.failedToCreate"));

        // Only upload files / register external links on the first session
        const uploadedAttachments =
          createdSessions.length === 0 &&
          (selectedFiles.length > 0 || selectedLinks.length > 0)
            ? await uploadFiles(newSession.id)
            : [];

        const newSessionVersion = await createSessionVersions({
          data: {
            session: {
              connect: { id: newSession.id },
            },
            name: data.name,
            staticProjectId: Number(projectId),
            staticProjectName:
              project?.name || t("common.labels.unknownProject"),
            project: {
              connect: { id: Number(projectId!) },
            },
            templateId: data.templateId,
            // Resolve the name from the project's templates list; fall
            // back to the default template (or anything else that's
            // assigned) so a form-state pointing at an unassigned ID still
            // submits a non-empty templateName. The server enforces
            // `templateName >= 1 char`, and the previous code returned
            // "" silently when the ID had no match.
            templateName:
              templates?.find((template) => template.id === data.templateId)
                ?.templateName ||
              defaultTemplate?.templateName ||
              templates?.[0]?.templateName ||
              "",
            configId: configId || null,
            configurationName: null,
            milestoneId: data.milestoneId || null,
            milestoneName:
              milestones?.find((m) => m.id === data.milestoneId)?.name || null,
            stateId: data.stateId,
            stateName:
              workflows?.find((workflow) => workflow.id === data.stateId)
                ?.name ||
              defaultWorkflow?.name ||
              workflows?.[0]?.name ||
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

      onClose();
      setIsSubmitting(false);
      const sessionsCreated = createdSessions.length;
      if (sessionsCreated > 1) {
        toast.success(
          t("sessions.messages.createSuccessMultiple", {
            count: sessionsCreated,
          })
        );
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
      if (isUniqueConstraintError(err)) {
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
    <Dialog open={open} onOpenChange={onClose}>
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
                          content={
                            noteContent && Object.keys(noteContent).length > 0
                              ? noteContent
                              : emptyEditorContent
                          }
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
                    return (
                      <FormItem>
                        <FormLabel className="flex items-center">
                          {t("common.fields.configurations")}
                          {selectedConfigs.length > 0 && (
                            <span className="ms-1 text-muted-foreground">
                              {"("}
                              {selectedConfigs.length}
                              {")"}
                            </span>
                          )}
                          <HelpPopover helpKey="session.configuration" />
                        </FormLabel>
                        <FormControl>
                          <MultiAsyncCombobox<ConfigurationOption>
                            value={selectedConfigs}
                            hideSelected={true}
                            onValueChange={(configs) => {
                              setSelectedConfigs(configs);
                              field.onChange(configs.map((c) => c.id));
                            }}
                            fetchOptions={(query, page, pageSize) =>
                              searchConfigurations(
                                query,
                                page,
                                pageSize,
                                numericProjectId
                              )
                            }
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
                            placeholder={t(
                              "common.placeholders.selectConfigurations"
                            )}
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
                          <UploadAttachments
                            onFileSelect={handleFileSelect}
                            allowLinks
                            onLinksChange={setSelectedLinks}
                          />
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
              <div className="space-y-4 me-6 max-w-[265px]">
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
                      {sourceTemplateUnassigned && defaultTemplate && (
                        <p
                          className="text-xs text-amber-600 dark:text-amber-400"
                          data-testid="duplicate-template-unassigned-warning"
                        >
                          {t.rich(
                            "sessions.duplicateDialog.templateUnassignedWarning",
                            {
                              name: defaultTemplate.templateName,
                              strong: (chunks) => <strong>{chunks}</strong>,
                            }
                          )}
                        </p>
                      )}
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
                                      disabled={workflow.disabledForCreate}
                                    >
                                      <WorkflowStateDisplay
                                        state={{
                                          name: workflow.label,
                                          icon: {
                                            name: workflow.icon as IconName,
                                          },
                                          color: {
                                            value: workflow.color ?? "",
                                          },
                                          requiresReview:
                                            workflow.requiresReview,
                                        }}
                                        size="sm"
                                      />
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </FormControl>
                      {firstGatedSessionOrder !== null && (
                        <FormDescription>
                          {t("reviews.transitionGate.gatedStatesNotSelectable")}
                        </FormDescription>
                      )}
                      {sourceStateUnassigned && defaultWorkflow && (
                        <p
                          className="text-xs text-amber-600 dark:text-amber-400"
                          data-testid="duplicate-state-unassigned-warning"
                        >
                          {t.rich(
                            "sessions.duplicateDialog.stateUnassignedWarning",
                            {
                              name: defaultWorkflow.name,
                              strong: (chunks) => <strong>{chunks}</strong>,
                            }
                          )}
                        </p>
                      )}
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
              <Button
                type="submit"
                disabled={isSubmitting || !defaultTemplate || !defaultWorkflow}
              >
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
