"use client";

import { SearchHelpContent } from "@/components/search/SearchHelpContent";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet";
import { UnifiedSearch } from "@/components/UnifiedSearch";
import { HelpCircle } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useRouter } from "~/lib/navigation";
import { SearchableEntityType, SearchHit } from "~/types/search";
import { isAdmin } from "~/utils/permissions";

interface GlobalSearchSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

export function GlobalSearchSheet({ isOpen, onClose }: GlobalSearchSheetProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const t = useTranslations();

  const handleResultClick = (hit: SearchHit) => {
    // If item is deleted and user is admin, navigate to admin trash page
    if (hit.source.isDeleted && isAdmin(session)) {
      router.push("/admin/trash");
      onClose();
      return;
    }

    // Navigate based on entity type for non-deleted items
    switch (hit.entityType) {
      case SearchableEntityType.REPOSITORY_CASE:
        router.push(`/projects/repository/${hit.source.projectId}/${hit.id}`);
        break;
      case SearchableEntityType.SHARED_STEP:
        router.push(
          `/projects/shared-steps/${hit.source.projectId}?groupId=${hit.id}`
        );
        break;
      case SearchableEntityType.TEST_RUN:
        router.push(`/projects/runs/${hit.source.projectId}/${hit.id}`);
        break;
      case SearchableEntityType.SESSION:
        router.push(`/projects/sessions/${hit.source.projectId}/${hit.id}`);
        break;
      case SearchableEntityType.PROJECT:
        router.push(`/projects/overview/${hit.id}`);
        break;
      case SearchableEntityType.ISSUE:
        // For issues, we'll navigate without the issueId parameter and handle it differently
        router.push(
          `/projects/issues/${hit.source.projectId}?issueId=${hit.id}`
        );
        break;
      case SearchableEntityType.MILESTONE:
        router.push(`/projects/milestones/${hit.source.projectId}/${hit.id}`);
        break;
    }
    onClose();
  };

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent
        className="sm:max-w-3xl overflow-y-auto"
        data-testid="global-search-sheet"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center">
            {t("search.title")}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="ml-2 inline-flex"
                  aria-label="Help"
                >
                  <HelpCircle className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="bottom"
                align="start"
                className="w-96 max-h-fit overflow-y-auto text-sm"
              >
                <SearchHelpContent />
              </PopoverContent>
            </Popover>
          </SheetTitle>
          <SheetDescription className="sr-only">
            {t("search.title")}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6">
          <UnifiedSearch
            showEntitySelector={true}
            showProjectToggle={true}
            compactMode={false}
            onResultClick={handleResultClick}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
