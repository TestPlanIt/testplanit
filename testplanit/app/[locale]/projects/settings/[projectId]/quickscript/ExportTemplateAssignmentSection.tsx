"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  useCreateManyCaseExportTemplateProjectAssignment,
  useDeleteManyCaseExportTemplateProjectAssignment,
  useFindManyCaseExportTemplate,
  useFindManyCaseExportTemplateProjectAssignment,
} from "~/lib/hooks";
import { useUpdateProjects } from "~/lib/hooks";

interface ExportTemplateAssignmentSectionProps {
  projectId: number;
  currentDefaultId: number | null;
}

export function ExportTemplateAssignmentSection({
  projectId,
  currentDefaultId,
}: ExportTemplateAssignmentSectionProps) {
  const t = useTranslations("projects.settings.quickScript");

  type TemplateOption = {
    id: number;
    name: string;
    category: string;
    framework: string;
    language: string;
  };

  const { data: templates, isLoading: templatesLoading } =
    useFindManyCaseExportTemplate({
      where: { isDeleted: false, isEnabled: true },
      select: {
        id: true,
        name: true,
        category: true,
        framework: true,
        language: true,
      },
    });

  const { data: assignments, isLoading: assignmentsLoading } =
    useFindManyCaseExportTemplateProjectAssignment({
      where: { projectId },
      select: { templateId: true },
    });

  const { mutateAsync: deleteManyAssignment } =
    useDeleteManyCaseExportTemplateProjectAssignment();
  const { mutateAsync: createManyAssignment } =
    useCreateManyCaseExportTemplateProjectAssignment();
  const updateProject = useUpdateProjects();

  const [selectedTemplates, setSelectedTemplates] = useState<TemplateOption[]>(
    []
  );
  const [selectedDefaultId, setSelectedDefaultId] = useState<number | null>(
    currentDefaultId
  );
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Initialize selectedTemplates from server data once loaded
  useEffect(() => {
    if (assignments && templates) {
      const assignedIds = new Set(assignments.map((a) => a.templateId));
      setSelectedTemplates(templates.filter((tpl) => assignedIds.has(tpl.id)));
      setIsDirty(false);
    }
  }, [assignments, templates]);

  // Initialize selectedDefaultId from prop
  useEffect(() => {
    setSelectedDefaultId(currentDefaultId);
  }, [currentDefaultId]);

  const selectedIds = useMemo(
    () => new Set(selectedTemplates.map((t) => t.id)),
    [selectedTemplates]
  );

  const handleTemplatesChange = useCallback(
    (newSelected: TemplateOption[]) => {
      setSelectedTemplates(newSelected);
      // Clear default if it's no longer in the selected set
      const newIds = new Set(newSelected.map((t) => t.id));
      if (selectedDefaultId != null && !newIds.has(selectedDefaultId)) {
        setSelectedDefaultId(null);
      }
      setIsDirty(true);
    },
    [selectedDefaultId]
  );

  const sortedTemplates = useMemo(
    () => [...(templates ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [templates]
  );

  const fetchTemplateOptions = useCallback(
    async (query: string) => {
      if (!query) return sortedTemplates;
      const lower = query.toLowerCase();
      return sortedTemplates.filter(
        (tpl) =>
          tpl.name.toLowerCase().includes(lower) ||
          tpl.category.toLowerCase().includes(lower) ||
          tpl.framework.toLowerCase().includes(lower) ||
          tpl.language.toLowerCase().includes(lower)
      );
    },
    [sortedTemplates]
  );

  const handleDefaultChange = (value: string) => {
    setSelectedDefaultId(value === "none" ? null : parseInt(value));
    setIsDirty(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Step 1: Delete all existing assignments for this project
      await deleteManyAssignment({ where: { projectId } });

      // Step 2: Create new assignments
      const ids = Array.from(selectedIds);
      if (ids.length > 0) {
        await createManyAssignment({
          data: ids.map((templateId) => ({ templateId, projectId })),
        });
      }

      // Step 3: Update default (always — either set to selectedDefaultId or null)
      const defaultStillAssigned =
        selectedDefaultId != null && selectedIds.has(selectedDefaultId);
      await updateProject.mutateAsync({
        where: { id: projectId },
        data: {
          defaultCaseExportTemplateId: defaultStillAssigned
            ? selectedDefaultId
            : null,
        },
      });

      setIsDirty(false);
      toast.success(t("exportTemplates.saved"));
    } catch {
      toast.error(t("exportTemplates.saveError"));
    } finally {
      setIsSaving(false);
    }
  };

  const isLoading = templatesLoading || assignmentsLoading;

  return (
    <Card data-testid="export-template-assignment-section">
      <CardHeader>
        <CardTitle>{t("exportTemplates.title")}</CardTitle>
        <CardDescription>{t("exportTemplates.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : !templates || templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("exportTemplates.noTemplates")}
          </p>
        ) : (
          <>
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {t("exportTemplates.assignedLabel")}
              </Label>
              <MultiAsyncCombobox<TemplateOption>
                value={selectedTemplates}
                onValueChange={handleTemplatesChange}
                fetchOptions={fetchTemplateOptions}
                getOptionValue={(tpl) => tpl.id}
                getOptionLabel={(tpl) => tpl.name}
                renderOption={(tpl) => (
                  <span className="flex items-center w-full">
                    <span>{tpl.name}</span>
                    <span className="flex items-center gap-1.5 ml-auto mr-2">
                      {tpl.category && (
                        <Badge
                          variant="secondary"
                          className="border-primary-foreground text-xs"
                        >
                          {tpl.category}
                        </Badge>
                      )}
                      {tpl.language && (
                        <Badge
                          variant="secondary"
                          className="border-primary-foreground text-xs"
                        >
                          {tpl.language}
                        </Badge>
                      )}
                    </span>
                  </span>
                )}
                placeholder={t("exportTemplates.selectPlaceholder")}
              />
            </div>

            {/* Default template selector */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {t("exportTemplates.defaultLabel")}
              </Label>
              <Select
                value={
                  selectedDefaultId != null ? String(selectedDefaultId) : "none"
                }
                onValueChange={handleDefaultChange}
                disabled={selectedTemplates.length === 0}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={t("exportTemplates.defaultPlaceholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    {t("exportTemplates.defaultPlaceholder")}
                  </SelectItem>
                  {selectedTemplates.map((template) => (
                    <SelectItem key={template.id} value={String(template.id)}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={!isDirty || isSaving}>
                {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                {isSaving
                  ? t("exportTemplates.saving")
                  : t("exportTemplates.save")}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
