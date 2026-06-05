"use client";

import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PaginationProvider,
  usePagination,
} from "~/lib/contexts/PaginationContext";
import { usePageSizeOptions } from "~/hooks/usePageSizeOptions";
import { useRouter } from "~/lib/navigation";

import { useDebounce } from "@/components/Debounce";
import { ColumnSelection } from "@/components/tables/ColumnSelection";
import { DataTable } from "@/components/tables/DataTable";
import { useFindManyScimToken, useUpdateScimToken } from "~/lib/hooks";
import { ExtendedScimToken, useColumns } from "./columns";

import { Filter } from "@/components/tables/Filter";

import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { revokeScimTokenAction } from "~/app/actions/scimTokenActions";

import { MintDialog } from "./MintDialog";

export default function ScimTokensPage() {
  return (
    <PaginationProvider>
      <ScimTokensList />
    </PaginationProvider>
  );
}

function ScimTokensList() {
  const t = useTranslations("admin.scim");
  const tApiTokens = useTranslations("admin.apiTokens");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const { data: session, status } = useSession();
  const router = useRouter();
  const {
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    totalItems,
    setTotalItems,
    startIndex,
    endIndex,
    totalPages,
  } = usePagination();
  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({
    column: "createdAt",
    direction: "desc",
  });
  const [searchString, setSearchString] = useState("");
  const debouncedSearchString = useDebounce(searchString, 500);
  const [showRevokedTokens, setShowRevokedTokens] = useState<boolean>(false);

  // Revoke single token dialog state
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false);
  const [tokenToRevoke, setTokenToRevoke] = useState<ExtendedScimToken | null>(
    null
  );
  const [isRevoking, setIsRevoking] = useState(false);

  // Mint dialog state — Plan 06-08 wires the actual reveal flow into this slot.
  // The plaintext bearer is held in React useState ONLY, never in any query cache.
  const [mintDialogOpen, setMintDialogOpen] = useState(false);

  // Map column IDs to actual database field names for orderBy
  const columnToFieldMap: Record<string, string> = {
    createdBy: "createdById",
    status: "isActive",
  };

  const effectivePageSize =
    typeof pageSize === "number" ? pageSize : totalItems;
  const skip = (currentPage - 1) * effectivePageSize;
  const sortField = sortConfig
    ? columnToFieldMap[sortConfig.column] || sortConfig.column
    : "createdAt";

  const { mutateAsync: updateScimToken } = useUpdateScimToken();

  // Stabilize mutation ref — ZenStack's mutateAsync changes identity every render
  const updateScimTokenRef = useRef(updateScimToken);
  useEffect(() => {
    updateScimTokenRef.current = updateScimToken;
  });

  const { data: totalFilteredTokens } = useFindManyScimToken(
    {
      orderBy: { [sortField]: sortConfig?.direction || "desc" },
      where: {
        AND: [
          {
            OR: [
              {
                name: {
                  contains: debouncedSearchString,
                  mode: "insensitive",
                },
              },
              {
                idpName: debouncedSearchString
                  ? {
                      equals: debouncedSearchString.toUpperCase() as any,
                    }
                  : undefined,
              },
            ],
          },
          showRevokedTokens ? {} : { isActive: true, revokedAt: null },
        ],
      },
    },
    {
      enabled: !!session?.user,
      refetchOnWindowFocus: true,
    }
  );

  // Update total items in pagination context
  useEffect(() => {
    if (totalFilteredTokens) {
      setTotalItems(totalFilteredTokens.length);
    }
  }, [totalFilteredTokens, setTotalItems]);

  const {
    data: tokens,
    isLoading,
    refetch: refetchTokens,
  } = useFindManyScimToken(
    {
      orderBy: { [sortField]: sortConfig?.direction || "desc" },
      where: {
        AND: [
          {
            OR: [
              {
                name: {
                  contains: debouncedSearchString,
                  mode: "insensitive",
                },
              },
              {
                idpName: debouncedSearchString
                  ? {
                      equals: debouncedSearchString.toUpperCase() as any,
                    }
                  : undefined,
              },
            ],
          },
          showRevokedTokens ? {} : { isActive: true, revokedAt: null },
        ],
      },
      take: effectivePageSize,
      skip: skip,
    },
    {
      enabled: !!session?.user,
      refetchOnWindowFocus: true,
    }
  );

  const pageSizeOptions = usePageSizeOptions(totalItems);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchString, setCurrentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [pageSize, setCurrentPage]);

  useEffect(() => {
    if (status !== "loading" && !session) {
      router.push("/");
    }
  }, [status, session, router]);

  const handleRevoke = useCallback((token: ExtendedScimToken) => {
    setTokenToRevoke(token);
    setRevokeDialogOpen(true);
  }, []);

  const handleConfirmRevoke = useCallback(async () => {
    if (!tokenToRevoke) return;

    setIsRevoking(true);
    try {
      const result = await revokeScimTokenAction(tokenToRevoke.id);
      if (result.success) {
        toast.success(t("revoke.successToast"));
        void refetchTokens();
        setRevokeDialogOpen(false);
        setTokenToRevoke(null);
      } else {
        toast.error(
          t("revoke.errorToast", { reason: result.error ?? "Unknown" })
        );
      }
    } catch (err) {
      toast.error(
        t("revoke.errorToast", {
          reason: err instanceof Error ? err.message : "Unknown",
        })
      );
    } finally {
      setIsRevoking(false);
    }
  }, [tokenToRevoke, t, refetchTokens]);

  // Extract stable primitives from session to avoid column remounts when session object changes
  const dateFormat = session?.user?.preferences?.dateFormat;
  const timezone = session?.user?.preferences?.timezone;
  const userPreferences = useMemo(
    () => ({ user: { preferences: { dateFormat, timezone } } }),
    [dateFormat, timezone]
  );

  const columns = useColumns(
    userPreferences,
    handleRevoke,
    t,
    tApiTokens,
    tCommon
  );

  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});

  if (status === "loading") return null;

  if (!session || session.user.access !== "ADMIN") {
    return null;
  }

  const handleSortChange = (column: string) => {
    const direction =
      sortConfig &&
      sortConfig.column === column &&
      sortConfig.direction === "asc"
        ? "desc"
        : "asc";
    setSortConfig({ column, direction });
    setCurrentPage(1);
  };

  return (
    <main data-testid="scim-admin-page">
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between text-primary text-2xl md:text-4xl">
            <div>
              <CardTitle data-testid="scim-page-title">
                {tGlobal("admin.menu.scim")}
              </CardTitle>
              <CardDescription className="mt-2">
                {t("description")}
              </CardDescription>
            </div>
            <div>
              <Button
                variant="default"
                size="sm"
                onClick={() => setMintDialogOpen(true)}
                data-testid="scim-mint-button"
              >
                <Plus className="h-4 w-4" />
                {t("mintCta")}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-row items-start">
            <div className="flex flex-col grow w-full sm:w-1/2 min-w-[250px]">
              <div className="text-muted-foreground w-full text-nowrap">
                <Filter
                  key="scim-tokens-filter"
                  placeholder={t("filterPlaceholder")}
                  initialSearchString={searchString}
                  onSearchChange={setSearchString}
                />
                <div className="flex flex-row items-center gap-2 mt-2">
                  <div className="m-2">
                    <ColumnSelection
                      key="scim-tokens-column-selection"
                      columns={columns}
                      onVisibilityChange={setColumnVisibility}
                    />
                  </div>
                  <div>
                    <Label
                      htmlFor="show-revoked-scim-tokens"
                      className="flex items-center gap-2"
                    >
                      <Switch
                        id="show-revoked-scim-tokens"
                        checked={showRevokedTokens}
                        onCheckedChange={(checked) => {
                          setShowRevokedTokens(checked);
                        }}
                      />
                      {t("showRevoked")}
                    </Label>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col w-full sm:w-2/3 items-end">
              {totalItems > 0 && (
                <>
                  <div className="justify-end">
                    <PaginationInfo
                      key="scim-tokens-pagination-info"
                      startIndex={startIndex}
                      endIndex={endIndex}
                      totalRows={totalItems}
                      searchString={searchString}
                      pageSize={typeof pageSize === "number" ? pageSize : "All"}
                      pageSizeOptions={pageSizeOptions}
                      handlePageSizeChange={(size) => setPageSize(size)}
                    />
                  </div>
                  <div className="justify-end -mx-4">
                    <PaginationComponent
                      currentPage={currentPage}
                      totalPages={totalPages}
                      onPageChange={setCurrentPage}
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          <div
            className="mt-4 flex justify-between"
            data-testid="scim-table"
          >
            {tokens && tokens.length > 0 ? (
              <DataTable<ExtendedScimToken, unknown>
                columns={columns}
                data={tokens as ExtendedScimToken[]}
                onSortChange={handleSortChange}
                sortConfig={sortConfig}
                columnVisibility={columnVisibility}
                onColumnVisibilityChange={setColumnVisibility}
                pageSize={typeof pageSize === "number" ? pageSize : totalItems}
                isLoading={isLoading}
              />
            ) : !isLoading ? (
              <div className="w-full text-center py-12 text-muted-foreground">
                {t("noTokens")}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("sectionConflicts")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t("conflictsPlaceholder")}
          </p>
        </CardContent>
      </Card>

      {/* Revoke Single Token Dialog */}
      <AlertDialog open={revokeDialogOpen} onOpenChange={setRevokeDialogOpen}>
        <AlertDialogContent className="border-destructive">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("revoke.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {tokenToRevoke &&
                t("revoke.description", { name: tokenToRevoke.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmRevoke}
              disabled={isRevoking}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isRevoking && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("revoke.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Mint Dialog — plaintext bearer is held only in MintDialog's local
          useState; refetch the token list on success so the new row appears. */}
      <MintDialog
        open={mintDialogOpen}
        onOpenChange={setMintDialogOpen}
        onSuccess={() => {
          void refetchTokens();
        }}
      />
    </main>
  );
}
