"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "~/lib/navigation";

import { useDebounce } from "@/components/Debounce";
import { ColumnSelection } from "@/components/tables/ColumnSelection";
import { DataTable } from "@/components/tables/DataTable";
import { ExtendedApiToken, useColumns } from "./columns";

import { Filter } from "@/components/tables/Filter";

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
import { SectionHeader } from "@/components/ui/typography";
import { HelpPopover } from "@/components/ui/help-popover";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AlertTriangle, Ban, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function ApiTokensPage() {
  return <ApiTokensList />;
}

function ApiTokensList() {
  const locale = useLocale();
  const t = useTranslations("admin.apiTokens");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const { data: session, status } = useSession();
  const router = useRouter();
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
  const [tokenToRevoke, setTokenToRevoke] = useState<ExtendedApiToken | null>(
    null
  );
  const [isRevoking, setIsRevoking] = useState(false);

  // Revoke all tokens dialog state
  const [revokeAllDialogOpen, setRevokeAllDialogOpen] = useState(false);
  const [revokeAllConfirmText, setRevokeAllConfirmText] = useState("");
  const [isRevokingAll, setIsRevokingAll] = useState(false);

  // Map column IDs to actual database field names for orderBy
  const columnToFieldMap: Record<string, string> = {
    user: "userId",
    status: "isActive",
  };

  const sortField = sortConfig
    ? columnToFieldMap[sortConfig.column] || sortConfig.column
    : "createdAt";

  const { mutateAsync: updateApiToken } =
    useClientQueries(schema).apiToken.useUpdate();

  // Stabilize mutation ref — ZenStack's mutateAsync changes identity every render
  const updateApiTokenRef = useRef(updateApiToken);
  useEffect(() => {
    updateApiTokenRef.current = updateApiToken;
  });

  const {
    data: tokens,
    isLoading,
    refetch: refetchTokens,
  } = useClientQueries(schema).apiToken.useFindMany(
    {
      orderBy: { [sortField]: sortConfig?.direction || "desc" },
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

  const tokenRows = useMemo(
    () => (tokens ?? []) as unknown as ExtendedApiToken[],
    [tokens]
  );

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
      await updateApiTokenRef.current({
        where: { id: tokenToRevoke.id },
        data: { isActive: false },
      });
      toast.success(t("revokeSuccess"));
      void refetchTokens();
      setRevokeDialogOpen(false);
      setTokenToRevoke(null);
    } catch {
      toast.error(t("revokeError"));
    } finally {
      setIsRevoking(false);
    }
  }, [tokenToRevoke, t, refetchTokens]);

  const handleRevokeAll = useCallback(async () => {
    if (revokeAllConfirmText !== "REVOKE ALL") return;

    setIsRevokingAll(true);
    try {
      // Get all active token IDs
      const activeTokenIds = tokenRows
        .filter((token) => token.isActive)
        .map((token) => token.id);

      // Revoke each token
      await Promise.all(
        activeTokenIds.map((id) =>
          updateApiTokenRef.current({
            where: { id },
            data: { isActive: false },
          })
        )
      );

      toast.success(t("revokeAllSuccess"));
      void refetchTokens();
      setRevokeAllDialogOpen(false);
      setRevokeAllConfirmText("");
    } catch {
      toast.error(t("revokeAllError"));
    } finally {
      setIsRevokingAll(false);
    }
  }, [revokeAllConfirmText, tokenRows, t, refetchTokens]);

  // Extract stable primitives from session to avoid column remounts when session object changes
  const dateFormat = session?.user?.preferences?.dateFormat;
  const timezone = session?.user?.preferences?.timezone;
  const userPreferences = useMemo(
    () => ({ user: { preferences: { dateFormat, timezone } } }),
    [dateFormat, timezone]
  );

  const columns = useColumns(userPreferences, handleRevoke, t, tCommon);

  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});
  // Hide-column requests from the table's header menu are routed through the
  // Columns control (the visibility owner) so persistence and its checkboxes
  // stay in sync.
  const hideColumnRef = useRef<((columnId: string) => void) | null>(null);

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
  };

  // Explicit-direction sort from the header column menu; `null` (Remove sort)
  // restores the default order.
  const handleSortColumn = (
    column: string,
    direction: "asc" | "desc" | null
  ) => {
    if (direction === null) {
      setSortConfig({ column: "createdAt", direction: "desc" });
    } else {
      setSortConfig({ column, direction });
    }
  };

  const activeTokenCount = tokenRows.filter((t) => t.isActive).length;

  return (
    <main>
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between gap-2">
            <SectionHeader className="flex items-center gap-2">
              <CardTitle data-testid="api-tokens-page-title">
                {tGlobal("admin.menu.apiTokens")}
              </CardTitle>
              <HelpPopover helpKey="apiTokens" />
            </SectionHeader>
            {activeTokenCount > 0 && (
              <Button
                variant="destructive"
                onClick={() => setRevokeAllDialogOpen(true)}
                aria-label={t("revokeAllTokens")}
                className="group gap-0 transition-all duration-200 hover:gap-2"
              >
                <Ban className="h-4 w-4" />
                <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40">
                  {t("revokeAllTokens")}
                </span>
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-row items-start justify-between gap-4">
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
                      storageKey="admin-api-tokens"
                      columns={columns}
                      onVisibilityChange={setColumnVisibility}
                      hideColumnRef={hideColumnRef}
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

            {tokenRows.length > 0 && (
              <p className="text-sm text-muted-foreground shrink-0">
                {tGlobal("admin.auditLogs.showing", {
                  loaded: tokenRows.length.toLocaleString(locale),
                  total: tokenRows.length.toLocaleString(locale),
                })}
              </p>
            )}
          </div>

          <div className="mt-4 w-full">
            <DataTable
              virtualized
              fillViewport
              columns={columns as any}
              data={tokenRows}
              onSortChange={handleSortChange}
              onSortColumn={handleSortColumn}
              onHideColumn={(columnId) => hideColumnRef.current?.(columnId)}
              sortConfig={sortConfig}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
              isLoading={isLoading}
              resetKey={`${debouncedSearchString}|${showRevokedTokens}|${sortConfig.column}|${sortConfig.direction}`}
              testIdPrefix="admin-api-tokens-table"
              rowTestIdPrefix="admin-api-token-row"
            />
          </div>
        </CardContent>
      </Card>

      {/* Revoke Single Token Dialog */}
      <AlertDialog open={revokeDialogOpen} onOpenChange={setRevokeDialogOpen}>
        <AlertDialogContent className="border-destructive">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("revokeConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {tokenToRevoke &&
                t("revokeConfirmDescription", {
                  name: tokenToRevoke.name,
                  user: tokenToRevoke.user.name || tokenToRevoke.user.email,
                })}
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
              {t("revokeToken")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Revoke All Tokens Dialog */}
      <AlertDialog
        open={revokeAllDialogOpen}
        onOpenChange={setRevokeAllDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {t("revokeAllTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-4">
              <p>{t("revokeAllDescription")}</p>
              <div className="space-y-2">
                <Label htmlFor="revoke-all-confirm">
                  {t("revokeAllConfirm")}
                </Label>
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
              {tCommon("cancel")}
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
