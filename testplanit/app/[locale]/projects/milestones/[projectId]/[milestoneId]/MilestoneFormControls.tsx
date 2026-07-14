import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { DateTextDisplay } from "@/components/DateTextDisplay";
import DynamicIcon from "@/components/DynamicIcon";
import { DatePickerField } from "@/components/forms/DatePickerField";
import {
  MilestoneSelect,
  transformMilestones,
} from "@/components/forms/MilestoneSelect";
import { UserDisplay } from "@/components/search/UserDisplay";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { HelpPopover } from "@/components/ui/help-popover";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Cloud, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useFormContext } from "react-hook-form";
import { emptyEditorContent } from "~/app/constants";
import { isTiptapEmpty } from "~/lib/tiptap/isTiptapEmpty";
import { IconName } from "~/types/globals";
import {
  ColorMap,
  createColorMap,
  getStatus,
  getStatusStyle,
} from "~/utils/milestoneUtils";

interface MilestoneFormControlsProps {
  isEditMode: boolean;
  isSubmitting: boolean;
  milestone: any;
  projectId: string;
  milestoneId: string;
}

export default function MilestoneFormControls({
  isEditMode,
  isSubmitting,
  milestone,
  projectId,
  milestoneId,
}: MilestoneFormControlsProps) {
  const { control, watch, setValue } = useFormContext();
  const completedAt = watch("completedAt");
  const enableNotifications = watch("enableNotifications");
  const hasDueDate = !!completedAt;
  const prevCompletedAtRef = useRef<Date | undefined | null>(undefined);
  const isInitialMount = useRef(true);

  // Toggle enableNotifications based on due date presence (only on user changes, not initial load)
  useEffect(() => {
    // Skip the initial mount
    if (isInitialMount.current) {
      isInitialMount.current = false;
      prevCompletedAtRef.current = completedAt;
      return;
    }

    // Only react if completedAt actually changed
    const prevHadDueDate = !!prevCompletedAtRef.current;
    const nowHasDueDate = !!completedAt;

    if (prevHadDueDate !== nowHasDueDate) {
      setValue("enableNotifications", nowHasDueDate);
    }

    prevCompletedAtRef.current = completedAt;
  }, [completedAt, setValue]);
  const { resolvedTheme } = useTheme();
  const t = useTranslations("milestones");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const { data: colors } = useClientQueries(schema).color.useFindMany({
    include: { colorFamily: true },
    orderBy: { colorFamily: { order: "asc" } },
  });

  const [colorMap, setColorMap] = useState<ColorMap | null>(null);

  useEffect(() => {
    if (colors) {
      const map = createColorMap(colors);
      setColorMap(map);
    }
  }, [colors]);

  // Fetch milestone types
  const { data: milestoneTypes } = useClientQueries(
    schema
  ).milestoneTypes.useFindMany({
    where: {
      AND: [
        {
          projects: {
            some: {
              projectId: Number(projectId),
            },
          },
        },
        { isDeleted: false },
      ],
    },
    include: { icon: true },
  });

  // Fetch milestones for parent selection
  const { data: milestones } = useClientQueries(schema).milestones.useFindMany({
    where: {
      projectId: Number(projectId),
      isDeleted: false,
      id: { not: Number(milestoneId) }, // Exclude current milestone
    },
    include: {
      milestoneType: {
        include: {
          icon: true,
        },
      },
    },
  });

  const milestoneTypesOptions = useMemo(() => {
    if (!milestoneTypes) return [];
    return milestoneTypes.map((type) => ({
      value: type.id.toString(),
      label: (
        <div className="flex items-center">
          <DynamicIcon
            name={(type.icon?.name as IconName) || "milestone"}
            className="w-4 h-4 me-2 shrink-0"
          />
          <span>{type.name}</span>
        </div>
      ),
    }));
  }, [milestoneTypes]);

  const milestonesOptions = useMemo(
    () => transformMilestones(milestones || []),
    [milestones]
  );

  // LOCK-01/04: tracker-owned fields (name/note/dates/started/completed) are
  // locked once a milestone is synced from Jira; automaticCompletion is
  // force-disabled since the tracker — not the local auto-complete worker —
  // owns isCompleted for a synced milestone (see forecastWorker LOCK-04).
  const isSynced = milestone?.integrationId != null;

  // Tracker-provided deep link to the source version/sprint. Only linkable when
  // it's a real http(s) URL (never `javascript:` etc.), mirroring the safety
  // check in MilestoneSourceBadge.
  const jiraUrl =
    typeof milestone?.externalUrl === "string" &&
    /^https?:\/\//i.test(milestone.externalUrl)
      ? milestone.externalUrl
      : null;

  return (
    <div className="space-y-4">
      {isSynced && (
        <Alert
          data-testid="milestone-sync-locked-alert"
          className="bg-inherit border-muted-foreground w-fit"
        >
          {/* Title only, with the explanatory copy tucked behind a help popover
              so the locked-sync notice stays a single compact line. The icon +
              title share a flex row (not the Alert's default absolute-svg slot,
              which is positioned for a taller title+description alert) so they
              stay vertically centered. */}
          <div className="flex items-center">
            <Cloud className="h-4 w-4 shrink-0" aria-hidden="true" />
            <AlertTitle className="mb-0 ms-2 flex items-center">
              {jiraUrl ? (
                <a
                  href={jiraUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:underline"
                  title={t("sync.openInJira")}
                >
                  {t("sync.managedByJira")}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : (
                t("sync.managedByJira")
              )}
              <HelpPopover helpKey="milestone.managedByJira" />
            </AlertTitle>
          </div>
        </Alert>
      )}
      {isEditMode ? (
        <>
          <div className="space-y-2">
            <FormField
              control={control}
              name="isStarted"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={!isEditMode || isSynced}
                    />
                  </FormControl>
                  <FormLabel>{tCommon("fields.started")}</FormLabel>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DatePickerField
              control={control}
              name="startedAt"
              label={tCommon("fields.startDate")}
              placeholder={tCommon("fields.startDate")}
              disabled={!isEditMode || isSynced}
            />
          </div>
          <Separator />
          <div className="space-y-2">
            <FormField
              control={control}
              name="isCompleted"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={!isEditMode || isSynced}
                    />
                  </FormControl>
                  <FormLabel>{tCommon("fields.completed")}</FormLabel>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DatePickerField
              control={control}
              name="completedAt"
              label={tGlobal("milestones.fields.dueDate")}
              placeholder={tGlobal("milestones.fields.dueDate")}
              disabled={!isEditMode || isSynced}
            />
            {!isSynced && (
              <FormField
                control={control}
                name="automaticCompletion"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={!isEditMode || !hasDueDate}
                      />
                    </FormControl>
                    <FormLabel className="flex items-center">
                      {t("fields.automaticCompletion")}
                      <HelpPopover helpKey="milestone.automaticCompletion" />
                    </FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={control}
              name="enableNotifications"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={!isEditMode || !hasDueDate}
                    />
                  </FormControl>
                  <FormLabel className="flex items-center">
                    {t("fields.notifyDaysBefore")}
                    <HelpPopover helpKey="milestone.notifyDaysBefore" />
                  </FormLabel>
                  <FormField
                    control={control}
                    name="notifyDaysBefore"
                    render={({ field: daysField }) => (
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          placeholder="5"
                          disabled={
                            !isEditMode || !hasDueDate || !enableNotifications
                          }
                          {...daysField}
                          onChange={(e) =>
                            daysField.onChange(parseInt(e.target.value) || 1)
                          }
                          className="max-w-[80px]"
                        />
                      </FormControl>
                    )}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </>
      ) : (
        milestone &&
        colorMap && (
          <div className="space-y-2">
            <Badge
              style={{
                backgroundColor: getStatusStyle(
                  getStatus(milestone),
                  resolvedTheme || "light",
                  colorMap
                ).badge,
              }}
              className="text-secondary-background border-2 border-secondary-foreground text-sm"
            >
              {t(`statusLabels.${getStatus(milestone)}` as any)}
            </Badge>
            {/* Shrink to the date text so the shared DateTextDisplay's baked-in
                text-end has no slack to push against, and the fit-content box
                sits at the start (left) of the sidebar. */}
            <div className="w-fit">
              <DateTextDisplay
                startDate={
                  milestone.startedAt ? new Date(milestone.startedAt) : null
                }
                endDate={
                  milestone.completedAt ? new Date(milestone.completedAt) : null
                }
                isCompleted={milestone.isCompleted}
              />
            </div>
            {milestone.completedAt && (
              <div className="space-y-1 pt-2">
                <div className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={milestone.automaticCompletion}
                    disabled
                    className="scale-75"
                  />
                  <span className="text-muted-foreground">
                    {t("fields.automaticCompletion")}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={milestone.notifyDaysBefore > 0}
                    disabled
                    className="scale-75"
                  />
                  <span className="text-muted-foreground">
                    {milestone.notifyDaysBefore > 0
                      ? t("fields.notifyDaysBeforeValue", {
                          count: milestone.notifyDaysBefore,
                        })
                      : t("fields.dueDateNotifications")}
                  </span>
                </div>
              </div>
            )}
          </div>
        )
      )}
      <Separator />
      <FormField
        control={control}
        name="note"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{tCommon("fields.description")}</FormLabel>
            {isEditMode || !isTiptapEmpty(milestone?.note) ? (
              <FormControl>
                <TipTapEditor
                  key={`editing-note-${isEditMode}`}
                  content={
                    field.value ? JSON.parse(field.value) : emptyEditorContent
                  }
                  onUpdate={(newContent) => {
                    if (isEditMode && !isSynced) {
                      field.onChange(JSON.stringify(newContent));
                    }
                  }}
                  readOnly={!isEditMode || isSynced}
                  className="h-auto"
                  placeholder={t("placeholders.description")}
                  projectId={projectId}
                />
              </FormControl>
            ) : (
              <div className="text-muted-foreground text-sm">
                {t("empty.description")}
              </div>
            )}
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name="milestoneTypesId"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{tCommon("fields.type")}</FormLabel>
            <Select
              disabled={!isEditMode || isSubmitting}
              onValueChange={(value) => field.onChange(Number(value))}
              value={field.value?.toString()}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder={t("placeholders.selectType")} />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {milestoneTypesOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name="parentId"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("fields.parent")}</FormLabel>
            <FormControl>
              <MilestoneSelect
                value={field.value ?? null}
                onChange={(value) =>
                  field.onChange(value == null ? null : Number(value))
                }
                milestones={milestonesOptions}
                disabled={!isEditMode || isSubmitting}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {milestone?.creator && (
        <div className="space-y-2">
          <FormLabel>{tCommon("fields.createdBy")}</FormLabel>
          <UserDisplay
            userId={milestone.creator.id}
            userName={milestone.creator.name}
            userImage={milestone.creator.image}
            size="small"
          />
        </div>
      )}

      {isSynced && milestone?.lastSyncedAt && (
        <div className="text-xs text-muted-foreground">
          {t("sync.lastSynced", {
            time: new Date(milestone.lastSyncedAt).toLocaleString(),
          })}
        </div>
      )}
    </div>
  );
}
