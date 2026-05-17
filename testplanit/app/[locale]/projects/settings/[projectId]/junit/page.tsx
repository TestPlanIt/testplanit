"use client";

import { useParams } from "next/navigation";
import { useEffect } from "react";

import { Loading } from "@/components/Loading";
import { useRouter } from "~/lib/navigation";

/**
 * Legacy route — JUnit settings were merged into the unified "Test Case
 * Parameters" page at /settings/[projectId]/parameters. This shim
 * redirects to the new path with the JUnit Mapping tab preselected so
 * existing bookmarks keep working.
 */
export default function LegacyJunitRedirect() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.projectId as string;

  useEffect(() => {
    router.replace(`/projects/settings/${projectId}/parameters?tab=junit`);
  }, [router, projectId]);

  return <Loading />;
}
