import { useQuery } from "@tanstack/react-query";
import LoadingSpinner from "@/components/LoadingSpinner";
import React, { useCallback } from "react";
import { BubbleChart } from "~/components/dataVisualizations/BubbleChart";
import { useRouter } from "~/lib/navigation";

interface TagsSectionProps {
  projectId: number;
}

type TagWithCount = {
  id: number;
  name: string;
  count: number;
};

const TagsSection: React.FC<TagsSectionProps> = ({ projectId }) => {
  const router = useRouter();
  // const currentLocale = useLocale(); // Removed as per user's previous change, assuming router handles it

  // Routed through a server endpoint (baseDb, no ZenStack policy plugin)
  // instead of the client-side ZenStack hook this replaced -- that hook's
  // filtered `_count`/`some` relation filters made ZenStack re-inline the
  // Projects ACL policy as a correlated per-row subquery, 120 of them per
  // call, 78s mean execution time in production.
  const { data, isLoading: isLoadingTags } = useQuery({
    queryKey: ["tagsForProject", projectId],
    queryFn: async () => {
      const response = await fetch(
        `/api/tags/for-project?projectId=${projectId}`
      );
      if (!response.ok) {
        throw new Error("Failed to fetch tags for project");
      }
      const body = await response.json();
      return body.tags as TagWithCount[];
    },
    enabled: Number.isFinite(projectId),
  });

  const filteredTags = data?.filter((tag) => tag.count > 0) ?? []; // Only include tags that have a count from at least one source

  const handleTagClickNavigation = useCallback(
    async (tagId: number) => {
      if (projectId && tagId != null) {
        const path = `/projects/tags/${projectId}/${tagId}`;
        try {
          await router.push(path);
        } catch (error) {
          console.error("[TagsSection] Error during router.push:", error);
        }
      }
    },
    [router, projectId]
  );

  if (isLoadingTags) {
    return (
      <div className="flex justify-center items-center py-8">
        <LoadingSpinner />
      </div>
    );
  }

  // This check is now more comprehensive, covering tags from all sources
  if (filteredTags.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-[300px]">
        <BubbleChart
          tags={filteredTags}
          onTagClick={handleTagClickNavigation}
        />
      </div>
    </div>
  );
};

export default TagsSection;
