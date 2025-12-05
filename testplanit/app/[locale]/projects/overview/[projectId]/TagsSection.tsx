import React, { useCallback } from "react";
import { Link, useRouter } from "~/lib/navigation";
import { LinkIcon, TagsIcon } from "lucide-react";
import { useFindManyTags } from "~/lib/hooks";
import { BubbleChart } from "~/components/dataVisualizations/BubbleChart";
import { useTranslations } from "next-intl";
import LoadingSpinner from "@/components/LoadingSpinner";

interface TagsSectionProps {
  projectId: number;
}

type TagWithCounts = {
  id: number;
  name: string;
  _count: {
    repositoryCases: number;
    testRuns: number;
    sessions: number;
  };
};

const TagsSection: React.FC<TagsSectionProps> = ({ projectId }) => {
  const t = useTranslations();
  const router = useRouter();
  // const currentLocale = useLocale(); // Removed as per user's previous change, assuming router handles it

  const { data: tags, isLoading: isLoadingTags } = useFindManyTags(
    {
      where: {
        isDeleted: false,
        OR: [
          {
            repositoryCases: {
              some: {
                isDeleted: false,
                isArchived: false,
                projectId,
              },
            },
          },
          {
            testRuns: {
              some: {
                projectId,
                isDeleted: false,
              },
            },
          },
          {
            sessions: {
              some: {
                projectId,
                isDeleted: false,
              },
            },
          },
        ],
      },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            repositoryCases: {
              where: {
                isDeleted: false,
                isArchived: false,
                projectId,
              },
            },
            testRuns: {
              where: {
                projectId,
                isDeleted: false,
              },
            },
            sessions: {
              where: {
                projectId,
                isDeleted: false,
              },
            },
          },
        },
      },
      orderBy: { name: "asc" },
      take: 100,
    },
    {
      // Enable tag fetching if projectId is valid, not just if repositoryCases exist
      enabled: Number.isFinite(projectId),
    }
  );

  const typedTags = tags as TagWithCounts[] | undefined;

  const filteredTags =
    typedTags
      ?.map((tag) => {
        const caseCount = tag._count.repositoryCases ?? 0;
        const runCount = tag._count.testRuns ?? 0;
        const sessionCount = tag._count.sessions ?? 0;

        return {
          id: tag.id,
          name: tag.name,
          count: caseCount + runCount + sessionCount,
        };
      })
      .filter((tag) => tag.count > 0) || []; // Only include tags that have a count from at least one source

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
      <p className="text-sm text-muted-foreground mb-4">
        <Link href={`/projects/tags/${projectId}`} className="group">
          {t("projects.overview.seeAllTags")}
          <LinkIcon className="w-4 h-4 inline ml-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        </Link>
      </p>
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
