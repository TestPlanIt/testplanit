"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { useFindManyProjects } from "~/lib/hooks";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ProjectIcon } from "@/components/ProjectIcon";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ProjectSelectionDialogProps {
  open: boolean;
  onClose: () => void;
  onNext: (projectIds: number[]) => void;
}

export const ProjectSelectionDialog: React.FC<ProjectSelectionDialogProps> = ({
  open,
  onClose,
  onNext,
}) => {
  const t = useTranslations("admin.milestones");
  const tCommon = useTranslations("common");
  const [selectedProjectIds, setSelectedProjectIds] = useState<number[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: projects, isLoading } = useFindManyProjects({
    where: {
      AND: [
        { isDeleted: false },
        searchQuery
          ? {
              name: {
                contains: searchQuery,
                mode: "insensitive",
              },
            }
          : {},
      ],
    },
    orderBy: { name: "asc" },
  });

  const handleToggleProject = (projectId: number) => {
    setSelectedProjectIds((prev) =>
      prev.includes(projectId)
        ? prev.filter((id) => id !== projectId)
        : [...prev, projectId]
    );
  };

  const handleSelectAll = () => {
    if (projects) {
      setSelectedProjectIds(projects.map((p) => p.id));
    }
  };

  const handleDeselectAll = () => {
    setSelectedProjectIds([]);
  };

  const handleNext = () => {
    if (selectedProjectIds.length > 0) {
      onNext(selectedProjectIds);
    }
  };

  const handleClose = () => {
    setSelectedProjectIds([]);
    setSearchQuery("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{t("wizard.selectProjects")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("wizard.selectProjects")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={tCommon("searchProjects", {
                count: projects?.length || 0,
              })}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex justify-between items-center">
            <div className="text-sm text-muted-foreground">
              {t("wizard.projectsSelected", { count: selectedProjectIds.length })}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleSelectAll}
                disabled={isLoading || !projects || projects.length === 0}
              >
                {tCommon("actions.selectAll")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleDeselectAll}
                disabled={selectedProjectIds.length === 0}
              >
                {tCommon("actions.deselectAll")}
              </Button>
            </div>
          </div>
          <ScrollArea className="h-[400px] border rounded-md p-4">
            {isLoading ? (
              <div className="text-center text-muted-foreground py-8">
                {tCommon("status.loading")}
              </div>
            ) : !projects || projects.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                {tCommon("messages.noProjects")}
              </div>
            ) : (
              <div className="space-y-3">
                {projects.map((project) => (
                  <div
                    key={project.id}
                    className="flex items-center space-x-3 p-2 rounded-md hover:bg-accent"
                  >
                    <Checkbox
                      id={`project-${project.id}`}
                      checked={selectedProjectIds.includes(project.id)}
                      onCheckedChange={() => handleToggleProject(project.id)}
                    />
                    <Label
                      htmlFor={`project-${project.id}`}
                      className="flex items-center gap-2 cursor-pointer flex-1"
                    >
                      <div className="w-6 h-6">
                        <ProjectIcon iconUrl={project.iconUrl} height={24} width={24} />
                      </div>
                      <span>{project.name}</span>
                    </Label>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleClose}>
            {tCommon("actions.cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleNext}
            disabled={selectedProjectIds.length === 0}
          >
            {tCommon("actions.next")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
