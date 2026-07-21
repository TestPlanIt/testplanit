"use client";

import { ProjectIcon } from "@/components/ProjectIcon";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";
import { useTranslations } from "next-intl";
import React, { useState } from "react";
import { searchProjects } from "~/app/actions/searchProjects";

type ProjectOption = Awaited<
  ReturnType<typeof searchProjects>
>["results"][number];

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
  const [selectedProjects, setSelectedProjects] = useState<ProjectOption[]>([]);

  const handleNext = () => {
    if (selectedProjects.length > 0) {
      onNext(selectedProjects.map((project) => project.id));
    }
  };

  const handleClose = () => {
    setSelectedProjects([]);
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
        <MultiAsyncCombobox<ProjectOption>
          value={selectedProjects}
          onValueChange={setSelectedProjects}
          fetchOptions={(query, page, pageSize) =>
            searchProjects(query, page, pageSize)
          }
          renderOption={(project) => (
            <div className="flex min-w-0 items-center gap-2">
              <ProjectIcon iconUrl={project.iconUrl} width={16} height={16} />
              <span className="truncate">{project.name}</span>
            </div>
          )}
          renderSelectedOption={(project) => <span>{project.name}</span>}
          getOptionValue={(project) => project.id}
          getOptionLabel={(project) => project.name}
          placeholder={t("wizard.selectProjects")}
          className="w-full"
          pageSize={20}
          showTotal
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleClose}>
            {tCommon("cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleNext}
            disabled={selectedProjects.length === 0}
          >
            {tCommon("actions.next")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
