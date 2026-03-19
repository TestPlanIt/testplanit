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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
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

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectedDefaultId, setSelectedDefaultId] = useState<number | null>(
    currentDefaultId
  );
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Initialize selectedIds from server data once loaded
  useEffect(() => {
    if (assignments) {
      setSelectedIds(new Set(assignments.map((a) => a.templateId)));
      setIsDirty(false);
    }
  }, [assignments]);

  // Initialize selectedDefaultId from prop
  useEffect(() => {
    setSelectedDefaultId(currentDefaultId);
  }, [currentDefaultId]);

  const handleCheckboxChange = (templateId: number, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(templateId);
      } else {
        next.delete(templateId);
        // Clear default if unchecking the default template
        if (templateId === selectedDefaultId) {
          setSelectedDefaultId(null);
        }
      }
      return next;
    });
    setIsDirty(true);
  };

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

  const assignedTemplates = (templates ?? []).filter((tpl) =>
    selectedIds.has(tpl.id)
  );

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
              {templates.map((template) => {
                const isChecked = selectedIds.has(template.id);
                const isDefault = template.id === selectedDefaultId;
                return (
                  <div
                    key={template.id}
                    className="flex items-center gap-3 rounded-md border p-3"
                  >
                    <Checkbox
                      id={`template-${template.id}`}
                      checked={isChecked}
                      onCheckedChange={(checked) =>
                        handleCheckboxChange(template.id, !!checked)
                      }
                    />
                    <Label
                      htmlFor={`template-${template.id}`}
                      className="flex flex-1 items-center gap-2 cursor-pointer font-medium"
                    >
                      {template.name}
                      {template.category && (
                        <Badge variant="secondary" className="text-xs">
                          {template.category}
                        </Badge>
                      )}
                      {template.language && (
                        <Badge variant="outline" className="text-xs">
                          {template.language}
                        </Badge>
                      )}
                      {isChecked && isDefault && (
                        <Badge variant="default" className="text-xs">
                          {t("exportTemplates.assigned")}
                        </Badge>
                      )}
                    </Label>
                  </div>
                );
              })}
            </div>

            {/* Default template selector */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {t("exportTemplates.defaultLabel")}
              </Label>
              <Select
                value={selectedDefaultId != null ? String(selectedDefaultId) : "none"}
                onValueChange={handleDefaultChange}
                disabled={assignedTemplates.length === 0}
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
                  {assignedTemplates.map((template) => (
                    <SelectItem key={template.id} value={String(template.id)}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={handleSave}
                disabled={!isDirty || isSaving}
              >
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
