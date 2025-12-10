"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "~/lib/navigation";
import { useTranslations } from "next-intl";
import {
  usePagination,
  PaginationProvider,
} from "~/lib/contexts/PaginationContext";

import { useFindManyApiToken, useUpdateApiToken } from "~/lib/hooks";
import { DataTable } from "@/components/tables/DataTable";
import { ExtendedApiToken, getColumns } from "./columns";
import { useDebounce } from "@/components/Debounce";
import { ColumnSelection } from "@/components/tables/ColumnSelection";

import { Filter } from "@/components/tables/Filter";

import { Label } from "@/components/ui/label";
import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Ban, Loader2, AlertTriangle } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

type PageSizeOption = number | "All";

export default function ApiTokensPage() {
  return (
    <PaginationProvider>
      <ApiTokensList />
    </PaginationProvider>
  );
}

function ApiTokensList() {
  const t = useTranslations("admin.apiTokens");
  const tCommon = useTranslations("common");
  const { data: session, status } = useSession();
  const router = useRouter();
  const { toast } = useToast();
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
  const [tokenToRevoke, setTokenToRevoke] = useState<ExtendedApiToken | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);

  // Revoke all tokens dialog state
  const [revokeAllDialogOpen, setRevokeAllDialogOpen] = useState(false);
  const [revokeAllConfirmText, setRevokeAllConfirmText] = useState("");
  const [isRevokingAll, setIsRevokingAll] = useState(false);

  // Calculate skip and take based on pageSize
  const effectivePageSize =
    typeof pageSize === "number" ? pageSize : totalItems;
  const skip = (currentPage - 1) * effectivePageSize;

  const { mutateAsync: updateApiToken } = useUpdateApiToken();

  const { data: totalFilteredTokens, isLoading: isTotalLoading } =
    useFindManyApiToken(
      {
        orderBy: sortConfig
          ? { [sortConfig.column]: sortConfig.direction }
          : { createdAt: "desc" },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
        },
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
                  user: {
                    name: {
                      contains: debouncedSearchString,
                      mode: "insensitive",
                    },
                  },
                },
                {
                  user: {
                    email: {
                      contains: debouncedSearchString,
                      mode: "insensitive",
                    },
                  },
                },
              ],
            },
            showRevokedTokens ? {} : { isActive: true },
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

  const { data: tokens, isLoading, refetch: refetchTokens } = useFindManyApiToken(
    {
      orderBy: sortConfig
        ? { [sortConfig.column]: sortConfig.direction }
        : { createdAt: "desc" },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
      },
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
                user: {
                  name: {
                    contains: debouncedSearchString,
                    mode: "insensitive",
                  },
                },
              },
              {
                user: {
                  email: {
                    contains: debouncedSearchString,
                    mode: "insensitive",
                  },
                },
              },
            ],
          },
          showRevokedTokens ? {} : { isActive: true },
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

  const pageSizeOptions: PageSizeOption[] = useMemo(() => {
    if (totalItems <= 10) {
      return ["All"];
    }
    const options: PageSizeOption[] = [10, 25, 50, 100, 250].filter(
      (size) => size < totalItems || totalItems === 0
    );
    options.push("All");
    return options;
  }, [totalItems]);

  // Reset to first page when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchString, setCurrentPage]);

  // Reset to first page when page size changes
  useEffect(() => {
    setCurrentPage(1);
  }, [pageSize, setCurrentPage]);

  useEffect(() => {
    if (status !== "loading" && !session) {
      router.push("/");
    }
  }, [status, session, router]);

  const handleRevoke = useCallback((token: ExtendedApiToken) => {
    setTokenToRevoke(token);
    setRevokeDialogOpen(true);
  }, []);

  const handleConfirmRevoke = useCallback(async () => {
    if (!tokenToRevoke) return;

    setIsRevoking(true);
    try {
      await updateApiToken({
        where: { id: tokenToRevoke.id },
        data: { isActive: false },
      });
      toast({
        title: t("revokeSuccess"),
      });
      refetchTokens();
      setRevokeDialogOpen(false);
      setTokenToRevoke(null);
    } catch (error) {
      toast({
        title: t("revokeError"),
        variant: "destructive",
      });
    } finally {
      setIsRevoking(false);
    }
  }, [tokenToRevoke, updateApiToken, toast, t, refetchTokens]);

  const handleRevokeAll = useCallback(async () => {
    if (revokeAllConfirmText !== "REVOKE ALL") return;

    setIsRevokingAll(true);
    try {
      // Get all active token IDs
      const activeTokenIds = totalFilteredTokens
        ?.filter((token) => token.isActive)
        .map((token) => token.id) || [];

      // Revoke each token
      await Promise.all(
        activeTokenIds.map((id) =>
          updateApiToken({
            where: { id },
            data: { isActive: false },
          })
        )
      );

      toast({
        title: t("revokeAllSuccess"),
      });
      refetchTokens();
      setRevokeAllDialogOpen(false);
      setRevokeAllConfirmText("");
    } catch (error) {
      toast({
        title: t("revokeAllError"),
        variant: "destructive",
      });
    } finally {
      setIsRevokingAll(false);
    }
  }, [revokeAllConfirmText, totalFilteredTokens, updateApiToken, toast, t, refetchTokens]);

  const columns = useMemo(
    () => getColumns(session, handleRevoke, t),
    [session, handleRevoke, t]
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

  const activeTokenCount = totalFilteredTokens?.filter((t) => t.isActive).length || 0;

  return (
    <main>
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between text-primary text-2xl md:text-4xl">
            <div>
              <CardTitle data-testid="api-tokens-page-title">{t("title")}</CardTitle>
              <CardDescription className="mt-2">{t("description")}</CardDescription>
            </div>
            <div>
              {activeTokenCount > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setRevokeAllDialogOpen(true)}
                >
                  <Ban className="h-4 w-4" />
                  {t("revokeAllTokens")}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-row items-start">
            <div className="flex flex-col grow w-full sm:w-1/2 min-w-[250px]">
              <div className="text-muted-foreground w-full text-nowrap">
                <Filter
                  key="api-tokens-filter"
                  placeholder={t("filterPlaceholder")}
                  initialSearchString={searchString}
                  onSearchChange={setSearchString}
                />
                <div className="flex flex-row items-center gap-2 mt-2">
                  <div className="m-2">
                    <ColumnSelection
                      key="api-tokens-column-selection"
                      columns={columns}
                      onVisibilityChange={setColumnVisibility}
                    />
                  </div>
                  <div>
                    <Label
                      htmlFor="revoked-tokens-checkbox"
                      className="flex items-center gap-2"
                    >
                      <Switch
                        id="revoked-tokens-checkbox"
                        checked={showRevokedTokens}
                        onCheckedChange={(checked) => {
                          setShowRevokedTokens(checked);
                        }}
                      />
                      {t("showInactive")}
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
                      key="api-tokens-pagination-info"
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

          <div className="mt-4 flex justify-between">
            {tokens && tokens.length > 0 ? (
              <DataTable<ExtendedApiToken, unknown>
                columns={columns}
                data={tokens || []}
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

      {/* Revoke Single Token Dialog */}
      <AlertDialog open={revokeDialogOpen} onOpenChange={setRevokeDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("revokeConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {tokenToRevoke && t("revokeConfirmDescription", {
                name: tokenToRevoke.name,
                user: tokenToRevoke.user.name || tokenToRevoke.user.email,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmRevoke}
              disabled={isRevoking}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isRevoking && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("revokeToken")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Revoke All Tokens Dialog */}
      <AlertDialog open={revokeAllDialogOpen} onOpenChange={setRevokeAllDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {t("revokeAllTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-4">
              <p>{t("revokeAllDescription")}</p>
              <div className="space-y-2">
                <Label htmlFor="revoke-all-confirm">{t("revokeAllConfirm")}</Label>
                <Input
                  id="revoke-all-confirm"
                  value={revokeAllConfirmText}
                  onChange={(e) => setRevokeAllConfirmText(e.target.value)}
                  placeholder={t("revokeAllPlaceholder")}
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setRevokeAllConfirmText("")}>
              {tCommon("actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevokeAll}
              disabled={isRevokingAll || revokeAllConfirmText !== "REVOKE ALL"}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isRevokingAll && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("revokeAllTokens")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
