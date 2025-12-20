"use client";

import { useState } from "react";
import { useRouter } from "~/lib/navigation";
import { useTranslations } from "next-intl";
import { Boxes, ExternalLink, ChevronDown } from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "~/utils";
import { useFindManyProjects } from "~/lib/hooks";

export const ProjectQuickSelector = () => {
  const router = useRouter();
  const t = useTranslations("common.ui.search");
  const tGlobal = useTranslations();
  const tNav = useTranslations("navigation");
  const [open, setOpen] = useState(false);

  // Use ZenStack hook to fetch projects
  const { data: projects = [], isLoading } = useFindManyProjects({
    where: {
      isDeleted: false,
    },
    orderBy: [{ isCompleted: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      iconUrl: true,
      isCompleted: true,
      isDeleted: true,
    },
  });

  const handleProjectSelect = (projectId: number) => {
    if (projectId === -1) {
      // Navigate to projects overview page
      router.push("/projects");
    } else {
      // Navigate directly to the project repository
      router.push(`/projects/repository/${projectId}`);
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="link" className="underline" aria-expanded={open}>
          {tGlobal("common.fields.projects")}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] px-0 py-2" align="start">
        <Command>
          <CommandInput placeholder={t("projects").toLowerCase() + "..."} />
          <CommandEmpty>
            {isLoading ? t("loadingProjects") : t("noProjectsFound")}
          </CommandEmpty>
          <CommandGroup className="max-h-[300px] overflow-y-auto">
            <CommandItem
              key={-1}
              value="view-all-projects"
              onSelect={() => handleProjectSelect(-1)}
              className="font-medium text-primary"
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              {t("viewAllProjects")}
            </CommandItem>
            {projects.map((project) => (
              <CommandItem
                key={project.id}
                value={project.name}
                onSelect={() => handleProjectSelect(project.id)}
              >
                {project.iconUrl ? (
                  <Image
                    src={project.iconUrl}
                    alt={`${project.name} icon`}
                    width={16}
                    height={16}
                    className="shrink-0 object-contain"
                  />
                ) : (
                  <Boxes className="h-4 w-4 shrink-0" />
                )}
                <span
                  className={cn(
                    "truncate",
                    project.isCompleted && "opacity-60"
                  )}
                >
                  {project.name}
                </span>
                {project.isCompleted && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {"(Complete)"}
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
