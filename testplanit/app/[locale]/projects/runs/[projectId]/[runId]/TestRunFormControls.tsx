import {
  AttachmentChanges,
  AttachmentsDisplay,
} from "@/components/AttachmentsDisplay";
import { ConfigurationNameDisplay } from "@/components/ConfigurationNameDisplay";
import { CreationInfo } from "@/components/CreationInfo";
import DynamicIcon from "@/components/DynamicIcon";
import { ConfigurationSelect } from "@/components/forms/ConfigurationSelect";
import { MilestoneSelect } from "@/components/forms/MilestoneSelect";
import { UnifiedIssueManager } from "@/components/issues/UnifiedIssueManager";
import { ManageTags } from "@/components/ManageTags";
import { IssuesDisplay } from "@/components/tables/IssuesDisplay";
import { TagsDisplay } from "@/components/tables/TagDisplay";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import UploadAttachments, {
  type LinkAttachmentInput,
} from "@/components/UploadAttachments";
import { WorkflowStateDisplay } from "@/components/WorkflowStateDisplay";
import type { Attachments, RepositoryCases, Tags } from "~/zenstack/models";
import { useTranslations } from "next-intl";
import { IconName } from "~/types/globals";
import { SelectedConfigurationInfo } from "./TestCasesSection";

type MilestoneWithType = {
  id: number;
  name: string;
  projectId: number;
  milestoneType: {
    id: number;
    name: string;
    isDeleted: boolean;
    iconId: number | null;
    isDefault: boolean;
    icon: {
      id: number;
      name: string;
    } | null;
  } | null;
};

type IssueType = {
  id: number;
  name: string;
  externalId: string | null;
  externalUrl?: string | null;
  externalKey?: string | null;
  title?: string | null;
  externalStatus?: string | null;
  data?: any;
  integrationId?: number | null;
  lastSyncedAt?: Date | null;
  issueTypeName?: string | null;
  issueTypeIconUrl?: string | null;
  integration?: {
    id: number;
    provider: string;
    name: string;
  } | null;
};

type WorkflowStateWithRelations = {
  id: number;
  name: string;
  order: number;
  iconId: number;
  colorId: number;
  isEnabled: boolean;
  isDeleted: boolean;
  isDefault: boolean;
  workflowType: string;
  scope: string;
  requiresReview?: boolean | null;
  icon: {
    id: number;
    name: string;
  } | null;
  color: {
    id: number;
    order: number;
    value: string;
    colorFamilyId: number;
  } | null;
};

type TransitionCheck = {
  allowed: boolean;
  blockingGate: { id: number; name: string } | null;
};

type TestRunWithRelations = {
  id: number;
  name: string;
  configId: number | null;
  milestoneId: number | null;
  stateId: number;
  note: any;
  docs: any;
  createdAt: Date;
  isDeleted: boolean;
  isCompleted: boolean;
  completedAt: Date | null;
  forecastManual: number | null;
  forecastAutomated: number | null;
  project: { id: number; name: string };
  configuration: { id: number; name: string } | null;
  milestone: MilestoneWithType | null;
  state: WorkflowStateWithRelations;
  createdBy: { id: string; name: string };
  attachments: Attachments[];
  testCases: Array<{
    id: number;
    order: number;
    status: {
      id: number;
      name: string;
      color: {
        value: string;
      };
    } | null;
    repositoryCase: RepositoryCases & {
      state: WorkflowStateWithRelations;
    };
  }>;
  tags: Tags[];
  issues: IssueType[];
};

type MilestoneOption = {
  value: string;
  label: string;
  milestoneType?: {
    icon?: { name?: IconName } | null;
  };
  parentId: number | null;
};

interface TestRunFormControlsProps {
  isEditMode: boolean;
  isSubmitting: boolean;
  testRun: TestRunWithRelations | null;
  control: any;
  errors: any;
  workflows: WorkflowStateWithRelations[] | undefined;
  milestones: MilestoneOption[];
  selectedTags: number[];
  setSelectedTags: (tags: number[]) => void;
  projectId: string | string[];
  handleFileSelect: (files: File[]) => void;
  handleLinksChange?: (links: LinkAttachmentInput[]) => void;
  handleSelect: (attachments: Attachments[], index: number) => void;
  selectedIssues: number[];
  setSelectedIssues: (ids: number[]) => void;
  canAddEdit: boolean;
  canCreateTags?: boolean;
  selectedConfigurationsForDisplay?: SelectedConfigurationInfo[];
  onAttachmentPendingChanges?: (changes: AttachmentChanges) => void;
  transitionCheck?: TransitionCheck;
}

function TestRunFormControls({
  isEditMode,
  isSubmitting,
  testRun,
  control,
  errors: _errors,
  workflows,
  milestones,
  selectedTags,
  setSelectedTags,
  projectId,
  handleFileSelect,
  handleLinksChange,
  handleSelect,
  selectedIssues,
  setSelectedIssues,
  canAddEdit,
  canCreateTags = false,
  selectedConfigurationsForDisplay = [],
  onAttachmentPendingChanges,
  transitionCheck,
}: TestRunFormControlsProps) {
  const t = useTranslations();

  if (!testRun) return null;

  return (
    <div className="space-y-4 [&_label]:text-base [&_label]:font-bold">
      {/* State */}
      <FormField
        control={control}
        name="stateId"
        render={({ field }) => {
          return (
            <FormItem>
              <FormLabel>{t("common.fields.state")}</FormLabel>
              <FormControl>
                {isEditMode ? (
                  <Select
                    onValueChange={(val) => field.onChange(Number(val))}
                    value={field.value?.toString()}
                    disabled={isSubmitting || !canAddEdit}
                  >
                    <SelectTrigger className="w-fit">
                      <SelectValue
                        placeholder={t("common.placeholders.selectState")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {workflows?.map((workflow) => (
                          <SelectItem
                            key={workflow.id}
                            value={workflow.id.toString()}
                          >
                            <WorkflowStateDisplay
                              state={{
                                name: workflow.name,
                                icon: {
                                  name: (workflow.icon?.name ??
                                    "circle") as IconName,
                                },
                                color: {
                                  value: workflow.color?.value ?? "",
                                },
                                requiresReview: workflow.requiresReview,
                              }}
                              size="sm"
                            />
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                ) : (
                  <WorkflowStateDisplay
                    state={{
                      name: testRun.state.name,
                      icon: testRun?.state.icon
                        ? { name: testRun.state.icon.name as IconName }
                        : { name: "circle" as IconName },
                      color: testRun.state.color || { value: "" },
                      requiresReview: testRun.state.requiresReview,
                    }}
                  />
                )}
              </FormControl>
              <FormMessage />
              {isEditMode &&
                transitionCheck &&
                !transitionCheck.allowed &&
                transitionCheck.blockingGate && (
                  <p className="text-[0.8rem] font-medium text-destructive mt-1">
                    {t("reviews.transitionGate.blockedByGate", {
                      gateName: transitionCheck.blockingGate.name,
                    })}
                  </p>
                )}
            </FormItem>
          );
        }}
      />
      {/* Configuration */}
      <FormField
        control={control}
        name="configId"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              {!isEditMode && selectedConfigurationsForDisplay.length > 1
                ? t("common.fields.configurations")
                : t("common.fields.configuration")}
            </FormLabel>
            <FormControl>
              {isEditMode ? (
                <ConfigurationSelect
                  value={field.value}
                  onChange={(val) => field.onChange(val)}
                  disabled={isSubmitting || !canAddEdit}
                  projectId={Number(projectId)}
                />
              ) : selectedConfigurationsForDisplay.length > 1 ? (
                <div className="flex flex-col gap-1">
                  {selectedConfigurationsForDisplay.map((config) => (
                    <ConfigurationNameDisplay
                      key={config.id}
                      name={config.configuration?.name || config.name}
                      iconClassName="mt-0.5 shrink-0"
                      truncate
                    />
                  ))}
                </div>
              ) : (
                <ConfigurationNameDisplay
                  name={testRun?.configuration?.name}
                  className="items-start"
                  iconClassName="mt-0.5"
                />
              )}
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      {/* Milestone */}
      <FormField
        control={control}
        name="milestoneId"
        render={({ field }) => {
          return (
            <FormItem>
              <FormLabel>{t("common.fields.milestone")}</FormLabel>
              <FormControl>
                {isEditMode ? (
                  <MilestoneSelect
                    value={field.value}
                    onChange={(val) =>
                      field.onChange(val === "none" ? null : Number(val))
                    }
                    milestones={milestones}
                    disabled={!canAddEdit}
                  />
                ) : (
                  <div className="flex items-start gap-1">
                    <DynamicIcon
                      name={
                        (testRun?.milestone?.milestoneType?.icon?.name ||
                          "milestone") as IconName
                      }
                      className="h-4 w-4 shrink-0 mt-0.5"
                    />
                    {testRun?.milestone?.name || t("common.access.none")}
                  </div>
                )}
              </FormControl>
              <FormMessage />
            </FormItem>
          );
        }}
      />
      {/* Issues */}
      <div className="space-y-2">
        <FormLabel>{t("common.fields.issues")}</FormLabel>
        {isEditMode ? (
          <UnifiedIssueManager
            projectId={Number(projectId)}
            linkedIssueIds={selectedIssues}
            setLinkedIssueIds={setSelectedIssues}
            entityType="testRun"
            entityId={testRun?.id}
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            {testRun?.issues && testRun.issues.length > 0 ? (
              testRun.issues.map((issue) => (
                <IssuesDisplay
                  key={issue.id}
                  id={issue.id}
                  name={issue.name}
                  externalId={issue.externalId}
                  externalUrl={issue.externalUrl}
                  title={issue.title}
                  status={issue.externalStatus}
                  projectIds={[Number(projectId)]}
                  size="small"
                  data={issue.data}
                  integrationProvider={issue.integration?.provider}
                  integrationId={
                    issue.integration?.id ?? issue.integrationId ?? undefined
                  }
                  issueTypeName={issue.issueTypeName}
                  issueTypeIconUrl={issue.issueTypeIconUrl}
                />
              ))
            ) : (
              <span className="text-muted-foreground text-sm">
                {t("common.access.none")}
              </span>
            )}
          </div>
        )}
      </div>
      {/* Tags */}
      <div className="space-y-2">
        <FormLabel>{t("common.fields.tags")}</FormLabel>
        {isEditMode ? (
          <ManageTags
            selectedTags={selectedTags}
            setSelectedTags={setSelectedTags}
            canCreateTags={canCreateTags}
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            {testRun?.tags && testRun.tags.length > 0 ? (
              testRun.tags.map((tag) => (
                <TagsDisplay
                  key={tag.id}
                  size="small"
                  id={tag.id}
                  name={tag.name}
                  link={`/projects/tags/${projectId}/${tag.id}`}
                />
              ))
            ) : (
              <span className="text-muted-foreground text-sm">
                {t("common.access.none")}
              </span>
            )}
          </div>
        )}
      </div>
      {/* Attachments */}
      <FormField
        control={control}
        name="attachments"
        render={({ field }) => {
          return (
            <FormItem>
              <FormLabel>{t("common.fields.attachments")}</FormLabel>
              <FormControl>
                <div className="space-y-4">
                  {isEditMode && (
                    <UploadAttachments
                      onFileSelect={handleFileSelect}
                      allowLinks={!!handleLinksChange}
                      onLinksChange={handleLinksChange}
                      disabled={!canAddEdit}
                    />
                  )}
                  <AttachmentsDisplay
                    attachments={
                      isEditMode
                        ? (field.value as Attachments[]) || []
                        : testRun.attachments
                    }
                    preventEditing={!canAddEdit}
                    onSelect={(attachments, index) => {
                      handleSelect(attachments, index);
                    }}
                    deferredMode={isEditMode}
                    onPendingChanges={onAttachmentPendingChanges}
                  />
                  {!isEditMode &&
                    (!testRun.attachments ||
                      testRun.attachments.length === 0) && (
                      <span className="text-muted-foreground text-sm">
                        {t("common.access.none")}
                      </span>
                    )}
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          );
        }}
      />
      {/* Created By - only shown in view mode */}
      {!isEditMode && (
        <CreationInfo
          userId={testRun?.createdBy.id}
          createdAt={testRun?.createdAt}
          className="w-fit"
        />
      )}
    </div>
  );
}

export default TestRunFormControls;
