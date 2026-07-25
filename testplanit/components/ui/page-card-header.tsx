"use client";

import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { ProjectIcon } from "@/components/ProjectIcon";
import { Button } from "@/components/ui/button";
import { CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpPopover } from "@/components/ui/help-popover";
import { SectionHeader } from "@/components/ui/typography";
import { Link } from "~/lib/navigation";

interface PageCardHeaderProps {
  /** Page title, rendered inside the standard primary SectionHeader. */
  title: React.ReactNode;
  /** Key under the `help` namespace; renders the "?" popover beside the title. */
  helpKey?: string;
  /** When set, a standard back button leads the title row. */
  backHref?: string;
  /** Right side of the title row. For buttons, use collapsibleActionClass +
   * ActionButtonContent from ui/action-bar so labels stay hover-expand. */
  actions?: React.ReactNode;
  /** Rendered as the CardDescription on its own line below the title row.
   * Project pages pass <ProjectHeaderInfo project={project} />. */
  description?: React.ReactNode;
  id?: string;
  className?: string;
  "data-testid"?: string;
}

/**
 * The app-standard page header. Owns the whole header convention — primary
 * medium title, optional "?" help popover, optional back button, right-aligned
 * actions, description on its own line — so a change here restyles every page.
 * The title row reserves the height of a default button (min-h-9) so pages
 * with and without actions share the same vertical rhythm.
 */
export function PageCardHeader({
  title,
  helpKey,
  backHref,
  actions,
  description,
  id,
  className,
  "data-testid": dataTestId,
}: PageCardHeaderProps) {
  const t = useTranslations("common");
  return (
    <CardHeader id={id} className={className} data-testid={dataTestId}>
      <div className="flex min-h-9 items-center gap-2">
        {backHref && (
          <Button
            asChild
            variant="outline"
            size="icon"
            className="me-2"
            aria-label={t("actions.back")}
          >
            <Link href={backHref}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
        )}
        <SectionHeader className="flex flex-1 items-center gap-2">
          <CardTitle>{title}</CardTitle>
          {helpKey && <HelpPopover helpKey={helpKey} />}
        </SectionHeader>
        {actions && <div className="flex items-center gap-3">{actions}</div>}
      </div>
      {description && <CardDescription>{description}</CardDescription>}
    </CardHeader>
  );
}

/** Standard project icon + name line for a project page's header description. */
export function ProjectHeaderInfo({
  project,
}: {
  project?: { name?: string | null; iconUrl?: string | null } | null;
}) {
  return (
    <span className="flex items-center gap-2">
      <ProjectIcon iconUrl={project?.iconUrl} />
      {project?.name}
    </span>
  );
}
