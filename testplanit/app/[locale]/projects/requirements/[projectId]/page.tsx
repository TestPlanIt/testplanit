"use client";

import { useParams } from "next/navigation";
import RequirementsWorkspace from "./RequirementsWorkspace";

export default function Page() {
  const params = useParams();
  const projectId = params.projectId as string;

  return <RequirementsWorkspace projectId={projectId} />;
}
