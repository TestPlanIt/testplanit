"use client";

import { useParams } from "next/navigation";
import { SharedDatasetEditor } from "../shared-dataset-editor";

export default function ProjectSharedDatasetEditorPage() {
  const params = useParams();
  const projectId = parseInt(params.projectId as string);
  const dataSetId = parseInt(params.dataSetId as string);

  if (
    !Number.isFinite(projectId) ||
    !Number.isFinite(dataSetId) ||
    isNaN(projectId) ||
    isNaN(dataSetId)
  ) {
    return null;
  }

  return <SharedDatasetEditor projectId={projectId} dataSetId={dataSetId} />;
}
