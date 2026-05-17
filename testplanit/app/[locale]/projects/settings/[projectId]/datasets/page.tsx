"use client";

import { useParams } from "next/navigation";
import { useEffect } from "react";

import { Loading } from "@/components/Loading";
import { useRouter } from "~/lib/navigation";

/**
 * Legacy route — datasets were merged into the unified "Test Case
 * Parameters" page at /settings/[projectId]/parameters. This shim
 * redirects to the new path with the Shared Datasets tab preselected
 * so existing bookmarks keep working.
 *
 * Deep dataset routes (/datasets/[dataSetId]/...) are independent and
 * remain at their original paths.
 */
export default function LegacyDatasetsRedirect() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.projectId as string;

  useEffect(() => {
    router.replace(`/projects/settings/${projectId}/parameters?tab=datasets`);
  }, [router, projectId]);

  return <Loading />;
}
