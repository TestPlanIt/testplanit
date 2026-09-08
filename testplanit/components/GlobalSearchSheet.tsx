"use client";

import { SearchHelpContent } from "@/components/search/SearchHelpContent";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { UnifiedSearch } from "@/components/UnifiedSearch";
import { HelpCircle } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { SearchableEntityType, SearchHit } from "~/types/search";
import { isAdmin } from "~/utils/permissions";

interface GlobalSearchSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

export function GlobalSearchSheet({ isOpen, onClose }: GlobalSearchSheetProps) {
  const { data: session } = useSession();
  const t = useTranslations();

  // Destination of a result card. The card renders it as a link, so the
  // browser owns the navigation and a command/ctrl-click opens a new tab.
  const getResultHref = (hit: SearchHit): string | null => {
    // If item is deleted and user is admin, navigate to admin trash page
    if (hit.source.isDeleted && isAdmin(session)) {
      return "/admin/trash";
    }

    // Navigate based on entity type for non-deleted items
    switch (hit.entityType) {
      case SearchableEntityType.REPOSITORY_CASE:
        return `/projects/repository/${hit.source.projectId}/${hit.id}`;
      case SearchableEntityType.SHARED_STEP:
        return `/projects/shared-steps/${hit.source.projectId}?groupId=${hit.id}`;
      case SearchableEntityType.TEST_RUN:
        return `/projects/runs/${hit.source.projectId}/${hit.id}`;
      case SearchableEntityType.SESSION:
        return `/projects/sessions/${hit.source.projectId}/${hit.id}`;
      case SearchableEntityType.PROJECT:
        return `/projects/overview/${hit.id}`;
      case SearchableEntityType.ISSUE:
        // For issues, we'll navigate without the issueId parameter and handle it differently
        return `/projects/issues/${hit.source.projectId}?issueId=${hit.id}`;
      case SearchableEntityType.MILESTONE:
        return `/projects/milestones/${hit.source.projectId}/${hit.id}`;
      default:
        return null;
    }
  };

  // Only fires for an unmodified click, which navigates in place; a new-tab
  // click leaves the sheet open on the results.
  const handleResultClick = () => {
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
                  className="ms-2 inline-flex"
                  aria-label={t("common.aria.help")}
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
            getResultHref={getResultHref}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
