import { useQuery } from "@tanstack/react-query";

interface FolderStats {
  folderId: number;
  directCaseCount: number;
  totalCaseCount: number;
}

interface UseFolderStatsOptions {
  projectId: number;
  runId?: number;
  enabled?: boolean;
}

export function useFolderStats({
  projectId,
  runId,
  enabled = true,
}: UseFolderStatsOptions) {
  return useQuery({
    queryKey: ["folderStats", projectId, runId],
    queryFn: async () => {
      const url = new URL(
        `/api/projects/${projectId}/folders/stats`,
        window.location.origin
      );
      if (runId) {
        url.searchParams.set("runId", runId.toString());
      }

      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error("Failed to fetch folder stats");
      }

      const data = await response.json();
      return data.stats as FolderStats[];
    },
    enabled: enabled && !!projectId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
