import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
} from "@/components/ui/select";
import { MilestoneSelect } from "@/components/forms/MilestoneSelect";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { Attachments, RepositoryCases, Tags } from "@prisma/client";
import { IconName } from "~/types/globals";
import DynamicIcon from "@/components/DynamicIcon";
import { ManageTags } from "@/components/ManageTags";
import { UnifiedIssueManager } from "@/components/issues/UnifiedIssueManager";
import {
  AttachmentsDisplay,
  AttachmentChanges,
} from "@/components/AttachmentsDisplay";
import UploadAttachments from "@/components/UploadAttachments";
import { TagsDisplay } from "@/components/tables/TagDisplay";
import { IssuesDisplay } from "@/components/tables/IssuesDisplay";
import { useTranslations, useLocale } from "next-intl";
import { WorkflowStateDisplay } from "@/components/WorkflowStateDisplay";
import { ConfigurationNameDisplay } from "@/components/ConfigurationNameDisplay";
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
  configurations: { id: number; name: string }[] | undefined;
  workflows: WorkflowStateWithRelations[] | undefined;
  milestones: MilestoneOption[];
  selectedTags: number[];
  setSelectedTags: (tags: number[]) => void;
  projectId: string | string[];
  handleFileSelect: (files: File[]) => void;
  handleSelect: (attachments: Attachments[], index: number) => void;
  projectIntegration?: any;
  selectedIssues: number[];
  setSelectedIssues: (ids: number[]) => void;
  canAddEdit: boolean;
  canCreateTags?: boolean;
  selectedConfigurationsForDisplay?: SelectedConfigurationInfo[];
  onAttachmentPendingChanges?: (changes: AttachmentChanges) => void;
}

function TestRunFormControls({
  isEditMode,
  isSubmitting,
  testRun,
  control,
  errors,
  configurations,
  workflows,
  milestones,
  selectedTags,
  setSelectedTags,
  projectId,
  handleFileSelect,
  handleSelect,
  projectIntegration,
  selectedIssues,
  setSelectedIssues,
  canAddEdit,
  canCreateTags = false,
  selectedConfigurationsForDisplay = [],
  onAttachmentPendingChanges,
}: TestRunFormControlsProps) {
  const t = useTranslations();

  if (!testRun) return null;

  return (
    <div className="space-y-4">
      {/* State */}
      <FormField
        control={control}
        name="stateId"
        render={({ field }) => {
          // Check if current value exists in workflows
          const currentValueExists = workflows?.some(
            (w) => w.id.toString() === field.value?.toString()
          );

          // If value doesn't exist and we have workflows, set to first workflow
          if (!currentValueExists && workflows?.length) {
            field.onChange(workflows[0].id);
          }

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
                    <SelectTrigger>
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
                            <div className="flex items-start gap-1">
                              <DynamicIcon
                                name={workflow.icon?.name as IconName}
                                color={workflow.color?.value}
                                className="w-4 h-4 shrink-0"
                              />
                              {workflow.name}
                            </div>
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
                    }}
                  />
                )}
              </FormControl>
              <FormMessage />
            </FormItem>
          );
        }}
      />
      {/* Configuration */}
      <FormField
        control={control}
        name="configId"
        render={({ field }) => {
          // Check if current value exists in configurations
          const currentValueExists = configurations?.some(
            (c) => c.id.toString() === field.value?.toString()
          );

          // For configuration, we allow null/0 as a valid value ("None")
          if (field.value && !currentValueExists) {
            field.onChange(null);
          }

          return (
            <FormItem>
              <FormLabel>
                {!isEditMode && selectedConfigurationsForDisplay.length > 1
                  ? t("common.fields.configurations")
                  : t("common.fields.configuration")}
              </FormLabel>
              <FormControl>
                {isEditMode ? (
                  <Select
                    onValueChange={(val) =>
                      field.onChange(val === "0" ? null : Number(val))
                    }
                    value={field.value?.toString() || "0"}
                    disabled={isSubmitting || !canAddEdit}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={t(
                          "common.placeholders.selectConfiguration"
                        )}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="0">
                          <div className="flex items-center gap-2">
                            {t("common.labels.none")}
                          </div>
                        </SelectItem>
                        {configurations?.map((config) => (
                          <SelectItem
                            key={config.id}
                            value={config.id.toString()}
                          >
                            <div className="flex items-start gap-1">
                              <DynamicIcon
                                name="combine"
                                className="h-4 w-4 shrink-0 mt-0.5"
                              />
                              {config.name}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
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
          );
        }}
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
                    {testRun?.milestone?.name || t("common.labels.none")}
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
            {testRun?.issues && testRun.issues.length > 0
              ? testRun.issues.map((issue) => (
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
                    integrationProvider={
                      projectIntegration?.integration?.provider
                    }
                    integrationId={projectIntegration?.integration?.id}
                    lastSyncedAt={issue.lastSyncedAt}
                    issueTypeName={issue.issueTypeName}
                    issueTypeIconUrl={issue.issueTypeIconUrl}
                  />
                ))
              : !isEditMode && (
                  <span className="text-muted-foreground text-sm">
                    {t("common.labels.none")}
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
            {testRun?.tags.map((tag) => (
              <TagsDisplay
                key={tag.id}
                id={tag.id}
                name={tag.name}
                link={`/projects/tags/${projectId}/${tag.id}`}
              />
            ))}
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
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          );
        }}
      />
      {/* Created By - only shown in view mode */}
      {!isEditMode && (
        <div className="w-fit space-y-2">
          <FormLabel>{t("common.fields.createdBy")}</FormLabel>
          <UserNameCell userId={testRun?.createdBy.id} hideLink={false} />
        </div>
      )}
    </div>
  );
}

export default TestRunFormControls;
