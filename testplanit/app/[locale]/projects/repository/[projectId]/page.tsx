"use client";

import { ApplicationArea } from "@prisma/client";
import { useParams } from "next/navigation";
import ProjectRepository from "./ProjectRepository";

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
