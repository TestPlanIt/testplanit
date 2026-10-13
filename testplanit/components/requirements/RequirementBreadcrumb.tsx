"use client";

import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRequirementAncestors } from "~/hooks/useRequirementAncestors";
import { Link } from "~/lib/navigation";
import { formatIssueDisplayText } from "~/utils/issueDisplayText";

interface RequirementBreadcrumbProps {
  projectId: string;
  requirementId: number;
  /** Where a crumb should point. The workspace passes a `?requirement=`
   *  URL so a crumb re-targets the panel in place; the standalone route
   *  passes its own path form. Kept as a builder rather than a boolean so
   *  neither surface has to know the other's URL shape. */
  hrefForAncestor: (ancestorId: number) => string;
}

/**
 * The path of parent requirements above the one on screen.
 *
 * Exists because both surfaces that show a requirement without the tree --
 * the full-width panel and the standalone route -- otherwise give no answer
 * to "where does this sit?". A requirement's meaning depends on its
 * ancestors in a way a test case's never did: coverage rolls UP through the
 * subtree, so a parent is covered by its children's cases.
 *
 * Renders nothing at all for a root requirement (no ancestors) rather than
 * an empty bar.
 */
export function RequirementBreadcrumb({
  projectId,
  requirementId,
  hrefForAncestor,
}: RequirementBreadcrumbProps) {
  const t = useTranslations("requirements.detail");
  const { ancestors } = useRequirementAncestors(
    Number(projectId),
    requirementId
  );

  if (ancestors.length === 0) return null;

  return (
    <nav
      aria-label={t("breadcrumbLabel")}
      className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground"
      data-testid="requirement-breadcrumb"
    >
      {ancestors.map((ancestor, index) => (
        <span key={ancestor.id} className="flex min-w-0 items-center gap-1">
          {index > 0 && (
            <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
          )}
          <Link
            href={hrefForAncestor(ancestor.id)}
            className="max-w-[220px] truncate hover:underline"
            data-testid={`requirement-breadcrumb-${ancestor.id}`}
          >
            {formatIssueDisplayText(ancestor)}
          </Link>
        </span>
      ))}
    </nav>
  );
}

export default RequirementBreadcrumb;
