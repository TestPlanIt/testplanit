"use client";

import { useParams } from "next/navigation";
import { useEffect } from "react";

import { Loading } from "@/components/Loading";
import { useRouter } from "~/lib/navigation";

export default function LegacyJunitRedirect() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.projectId as string;

  useEffect(() => {
    router.replace(`/projects/settings/${projectId}/parameters#junit`);
  }, [router, projectId]);

  return <Loading />;
}
