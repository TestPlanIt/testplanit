"use client";

/**
 * Per-project access mappings for one group, rendered inside the group edit
 * dialog beside the org-wide Mapped Access tier.
 *
 * Self-contained rather than a field on the surrounding react-hook-form:
 * each mapping is written immediately through its own server action, because
 * saving a mapping materializes permission rows and that must not ride along
 * with an unrelated group rename.
 */

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { FolderKanban, Trash } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FormLabel } from "@/components/ui/form";
import { HelpPopover } from "@/components/ui/help-popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  type GroupProjectMappingRow,
  listGroupProjectMappings,
  saveGroupProjectMapping,
} from "~/app/actions/scimProjectMappingActions";
import type { Access } from "~/zenstack/models";

/** NONE is absent by design — a group row cannot deny project access. */
const PROJECT_ACCESS_OPTIONS: Access[] = ["USER", "PROJECTADMIN", "ADMIN"];

interface GroupProjectMappingsProps {
  groupId: number;
}

export function GroupProjectMappings({ groupId }: GroupProjectMappingsProps) {
  const t = useTranslations("admin.groups.projectMappings");
  const tCommon = useTranslations("common");

  const [mappings, setMappings] = useState<GroupProjectMappingRow[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [newProjectId, setNewProjectId] = useState<string>("");
  const [newAccess, setNewAccess] = useState<Access>("USER");

  const { data: projects } = useClientQueries(schema).projects.useFindMany({
    where: { isDeleted: false },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const reload = useCallback(async () => {
    const result = await listGroupProjectMappings(groupId);
    if (result.success) setMappings(result.mappings);
  }, [groupId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const accessLabel = (access: Access) => {
    switch (access) {
      case "ADMIN":
        return tCommon("access.admin");
      case "PROJECTADMIN":
        return tCommon("access.projectAdmin");
      default:
        return tCommon("access.user");
    }
  };

  const save = async (projectId: number, access: Access | null) => {
    setIsSaving(true);
    try {
      const result = await saveGroupProjectMapping(groupId, projectId, access);
      if (!result.success) {
        toast.error(result.error ?? tCommon("errors.unknown"));
        return;
      }
      toast.success(t("saved"));
      setNewProjectId("");
      await reload();
    } finally {
      setIsSaving(false);
    }
  };

  const mappedProjectIds = new Set(mappings.map((m) => m.projectId));
  const availableProjects = (projects ?? []).filter(
    (p) => !mappedProjectIds.has(p.id)
  );

  return (
    <div
      className="space-y-2 pt-4 border-t"
      data-testid="group-project-mappings"
    >
      <FormLabel className="flex items-center">
        <FolderKanban className="w-4 h-4 me-1" />
        {t("label")}
        <HelpPopover helpKey="group.projectMappedAccess" />
      </FormLabel>

      <p className="text-sm text-muted-foreground">{t("description")}</p>

      {mappings.map((mapping) => (
        <div
          key={mapping.projectId}
          className="flex items-center gap-2"
          data-testid={`group-project-mapping-row-${mapping.projectId}`}
        >
          <span className="flex-1 text-sm truncate">{mapping.projectName}</span>
          <Select
            value={mapping.mappedAccess}
            disabled={isSaving}
            onValueChange={(value) => save(mapping.projectId, value as Access)}
          >
            <SelectTrigger className="w-44" aria-label={t("accessLabel")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROJECT_ACCESS_OPTIONS.map((access) => (
                <SelectItem key={access} value={access}>
                  {accessLabel(access)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={isSaving}
            aria-label={t("remove")}
            data-testid={`group-project-mapping-delete-${mapping.projectId}`}
            onClick={() => save(mapping.projectId, null)}
          >
            <Trash className="h-4 w-4" />
          </Button>
        </div>
      ))}

      {mappings.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      )}

      <div className="flex items-center gap-2 pt-2">
        <Select
          value={newProjectId}
          disabled={isSaving || availableProjects.length === 0}
          onValueChange={setNewProjectId}
        >
          <SelectTrigger
            className="flex-1"
            data-testid="group-project-mapping-project-select"
            aria-label={t("projectLabel")}
          >
            <SelectValue placeholder={t("projectPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {availableProjects.map((project) => (
              <SelectItem key={project.id} value={String(project.id)}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={newAccess}
          disabled={isSaving}
          onValueChange={(value) => setNewAccess(value as Access)}
        >
          <SelectTrigger
            className="w-44"
            data-testid="group-project-mapping-access-select"
            aria-label={t("accessLabel")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROJECT_ACCESS_OPTIONS.map((access) => (
              <SelectItem key={access} value={access}>
                {accessLabel(access)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          disabled={isSaving || !newProjectId}
          data-testid="group-project-mapping-add"
          onClick={() => save(Number(newProjectId), newAccess)}
        >
          {t("add")}
        </Button>
      </div>
    </div>
  );
}
