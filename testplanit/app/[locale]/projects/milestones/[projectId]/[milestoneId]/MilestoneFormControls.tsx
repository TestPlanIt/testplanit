import React, { useMemo, useState, useEffect, useRef } from "react";
import { useFormContext } from "react-hook-form";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { MoreHorizontal } from "lucide-react";
import { HelpPopover } from "@/components/ui/help-popover";
import { UserDisplay } from "@/components/search/UserDisplay";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  useFindManyMilestoneTypes,
  useFindManyMilestones,
  useFindManyColor,
} from "~/lib/hooks";
import DynamicIcon from "@/components/DynamicIcon";
import { IconName } from "~/types/globals";
import { Separator } from "@/components/ui/separator";
import {
  getStatus,
  getStatusStyle,
  createColorMap,
  ColorMap,
} from "~/utils/milestoneUtils";
import { Badge } from "@/components/ui/badge";
import { useTheme } from "next-themes";
import { DateTextDisplay } from "@/components/DateTextDisplay";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import { emptyEditorContent } from "~/app/constants";
import { useTranslations } from "next-intl";
import { DatePickerField } from "@/components/forms/DatePickerField";

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
  const { theme } = useTheme();
  const t = useTranslations("milestones");
  const tCommon = useTranslations("common");
  const { data: colors, isLoading: isColorsLoading } = useFindManyColor({
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
  const { data: milestoneTypes } = useFindManyMilestoneTypes({
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
  const { data: milestones } = useFindManyMilestones({
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
            className="w-4 h-4 mr-2 shrink-0"
          />
          <span>{type.name}</span>
        </div>
      ),
    }));
  }, [milestoneTypes]);

  const milestonesOptions = useMemo(() => {
    if (!milestones) return [];
    return milestones.map((m) => ({
      value: m.id.toString(),
      label: (
        <div className="flex items-center">
          <DynamicIcon
            name={(m.milestoneType?.icon?.name as IconName) || "milestone"}
            className="w-4 h-4 mr-2"
          />
          <span>{m.name}</span>
        </div>
      ),
      parentId: m.parentId,
    }));
  }, [milestones]);

  const renderMilestoneOptions = (
    milestones: {
      value: string;
      label: React.ReactElement;
      parentId: number | null;
    }[],
    parentId: number | null = null,
    level: number = 0
  ) => {
    const filteredMilestones = milestones.filter(
      (m) => m.parentId === parentId
    );
    return filteredMilestones.map((m) => (
      <React.Fragment key={m.value}>
        <SelectItem value={m.value} className={`pl-${level * 4 + 2}`}>
          {m.label}
        </SelectItem>
        {renderMilestoneOptions(milestones, Number(m.value), level + 1)}
      </React.Fragment>
    ));
  };

  return (
    <div className="space-y-4">
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
                      disabled={!isEditMode}
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
              disabled={!isEditMode}
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
                      disabled={!isEditMode}
                    />
                  </FormControl>
                  <FormLabel>{t("statusLabels.completed")}</FormLabel>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DatePickerField
              control={control}
              name="completedAt"
              label={t("labels.dueDate")}
              placeholder={t("labels.dueDate")}
              disabled={!isEditMode}
            />
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
                          disabled={!isEditMode || !hasDueDate || !enableNotifications}
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
                  theme || "light",
                  colorMap
                ).badge,
              }}
              className="text-secondary-background border-2 border-secondary-foreground text-sm"
            >
              {t(`statusLabels.${getStatus(milestone)}` as any)}
            </Badge>
            <DateTextDisplay
              startDate={
                milestone.startedAt ? new Date(milestone.startedAt) : null
              }
              endDate={
                milestone.completedAt ? new Date(milestone.completedAt) : null
              }
              isCompleted={milestone.isCompleted}
            />
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
            <FormLabel>{t("labels.description")}</FormLabel>
            {isEditMode ||
            (milestone?.note &&
              milestone?.note !== JSON.stringify(emptyEditorContent)) ? (
              <FormControl>
                <div
                  className={`relative group ${
                    !isEditMode
                      ? "max-h-[4em] overflow-hidden hover:max-h-none hover:overflow-visible hover:z-10"
                      : ""
                  }`}
                >
                  {!isEditMode && (
                    <>
                      <div className="absolute group-hover:hidden" />
                      <MoreHorizontal className="absolute right-0 bottom-0 h-4 w-4 bg-primary-foreground shrink-0 text-muted-foreground group-hover:hidden z-50" />
                    </>
                  )}
                  <div
                    className={`${
                      !isEditMode
                        ? "group-hover:rounded-md group-hover:p-0 group-hover:bg-background"
                        : ""
                    }`}
                  >
                    <TipTapEditor
                      key={`editing-note-${isEditMode}`}
                      content={
                        field.value
                          ? JSON.parse(field.value)
                          : emptyEditorContent
                      }
                      onUpdate={(newContent) => {
                        if (isEditMode) {
                          field.onChange(JSON.stringify(newContent));
                        }
                      }}
                      readOnly={!isEditMode}
                      className="h-auto"
                      placeholder={t("placeholders.description")}
                      projectId={projectId}
                    />
                  </div>
                </div>
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
            <FormLabel>{t("fields.type")}</FormLabel>
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
            <Select
              disabled={!isEditMode || isSubmitting}
              onValueChange={(value) =>
                field.onChange(value === "none" ? null : Number(value))
              }
              value={field.value ? field.value.toString() : "none"}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder={t("placeholders.selectParent")} />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="none">{tCommon("labels.none")}</SelectItem>
                {renderMilestoneOptions(milestonesOptions)}
              </SelectContent>
            </Select>
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
    </div>
  );
}
