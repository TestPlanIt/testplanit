"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useEffect } from "react";
import { REQUIREMENT_SCOPE_WHERE } from "~/lib/services/issueRoleScope";
import { useRouter } from "~/lib/navigation";
import { schema } from "~/zenstack/schema";

/**
 * Project-less permalink for a requirement, mirroring
 * `app/[locale]/case/[caseId]/page.tsx`: resolve the owning project, then
 * redirect to the project-scoped route.
 *
 * This exists so a surface that knows only a requirement id can still link
 * to it. The case-side Linked Requirements panel is exactly that surface —
 * it renders rows for requirements that may not belong to the project whose
 * URL the reader is currently on, and requiring it to carry a project id
 * would be a data change to serve a URL shape.
 *
 * `REQUIREMENT_SCOPE_WHERE` is load-bearing, not decoration: without it a
 * defect id would resolve here and redirect into the requirements feature.
 */
export default function RequirementPermalink() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { requirementId } = useParams();
  const t = useTranslations();

  const parsed = Number(requirementId);
  const id = Number.isFinite(parsed) ? parsed : null;

  const { data, isLoading } = useClientQueries(schema).issue.useFindFirst(
    {
      where: {
        id: id ?? -1,
        isDeleted: false,
        ...REQUIREMENT_SCOPE_WHERE,
      },
      select: { projectId: true },
    },
    { enabled: id != null }
  );

  useEffect(() => {
    if (status !== "loading" && !session) {
      router.push("/");
    }
  }, [status, session, router]);

  // An integration-only requirement can have a null home project, and there
  // is no project-scoped URL to send it to — treated as not found rather
  // than redirecting to a malformed path.
  const projectId = data?.projectId ?? null;

  useEffect(() => {
    if (projectId == null) return;
    router.replace(
      `/projects/requirements/${projectId}?requirement=${requirementId}`
    );
  }, [projectId, requirementId, router]);

  if (status === "loading" || isLoading) return null;

  if (projectId == null) {
    return (
      <div
        className="text-muted-foreground"
        data-testid="requirement-not-found"
      >
        {t("requirements.detail.notFound")}
      </div>
    );
  }

  return null;
}
