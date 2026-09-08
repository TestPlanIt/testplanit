"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
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
import { Boxes, ChevronDown, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { useState, type MouseEvent } from "react";
import { Link, useRouter } from "~/lib/navigation";
import { cn } from "~/utils";

export const ProjectQuickSelector = () => {
  const router = useRouter();
  const t = useTranslations("common.ui.search");
  const tGlobal = useTranslations();

  const [open, setOpen] = useState(false);

  // Use ZenStack hook to fetch projects
  const { data: projects = [], isLoading } = useClientQueries(
    schema
  ).projects.useFindMany({
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

  // -1 is the "view all projects" pseudo-entry.
  const projectPath = (projectId: number) =>
    projectId === -1 ? "/projects" : `/projects/repository/${projectId}`;

  const handleProjectSelect = (projectId: number) => {
    router.push(projectPath(projectId));
    setOpen(false);
  };

  // Each entry is a REAL link so modifier clicks get native browser behavior
  // (cmd/ctrl → new tab, shift → new window, middle-click). Plain clicks are
  // deferred to cmdk's onSelect instead — one navigation path shared with
  // keyboard selection, which also closes the popover.
  const handleLinkClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      // Native handling — but keep cmdk from ALSO selecting (which would
      // navigate this tab too).
      event.stopPropagation();
      return;
    }
    event.preventDefault();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          aria-expanded={open}
          className="h-auto rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
        >
          {tGlobal("common.fields.projects")}
          <ChevronDown className="size-3.5! opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] px-0 py-2" align="start">
        <Command className="py-0.5">
          <CommandInput placeholder={tGlobal("common.fields.projects")} />
          <CommandEmpty>
            {isLoading ? t("loadingProjects") : t("noProjectsFound")}
          </CommandEmpty>
          <CommandGroup className="max-h-[600px] overflow-y-auto">
            <CommandItem
              key={-1}
              value="view-all-projects"
              onSelect={() => handleProjectSelect(-1)}
              className="font-medium text-primary"
            >
              <Link
                href={projectPath(-1)}
                onClick={handleLinkClick}
                className="flex w-full min-w-0 items-center gap-2"
              >
                <ExternalLink className="h-4 w-4 shrink-0" />
                {t("viewAllProjects")}
              </Link>
            </CommandItem>
            {projects.map((project) => (
              <CommandItem
                key={project.id}
                value={project.name}
                onSelect={() => handleProjectSelect(project.id)}
              >
                <Link
                  href={projectPath(project.id)}
                  onClick={handleLinkClick}
                  className="flex w-full min-w-0 items-center gap-2"
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
                    <span className="ms-2 text-xs text-muted-foreground">
                      {"(Complete)"}
                    </span>
                  )}
                </Link>
              </CommandItem>
            ))}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
