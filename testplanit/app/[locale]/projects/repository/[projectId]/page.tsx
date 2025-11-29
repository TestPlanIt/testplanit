"use client";

import ProjectRepository from "./ProjectRepository";
import { useParams } from "next/navigation";
import { ApplicationArea } from "@prisma/client";

export default function Page() {
  const params = useParams();
  const projectId = params.projectId as string;

  return (
    <ProjectRepository
      projectId={projectId}
      ApplicationArea={ApplicationArea.TestCaseRepository}
    />
  );
}
