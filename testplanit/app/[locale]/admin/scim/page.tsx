"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "~/lib/navigation";

import { useDebounce } from "@/components/Debounce";
import { ColumnSelection } from "@/components/tables/ColumnSelection";
import { VirtualizedDataTable } from "@/components/tables/VirtualizedDataTable";
import { ExtendedScimToken, useColumns } from "./columns";

import { Filter } from "@/components/tables/Filter";

import { UserNameCell } from "@/components/tables/UserNameCell";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { revokeScimTokenAction } from "~/app/actions/scimTokenActions";
import {
  type DowngradedUser,
  enqueueFallbackDefaultRecompute,
  previewFallbackDefaultChange,
} from "~/app/actions/scimMappingActions";
import { SCIM_DEFAULT_MAPPED_ACCESS_KEY } from "~/lib/scim/access/fallbackDefault";
import type { Access } from "~/zenstack/models";

import { ConflictLogTable } from "./ConflictLogTable";
import { MintDialog } from "./MintDialog";

export default function ScimTokensPage() {
  return <ScimTokensList />;
}

function FallbackDefaultCard() {
  const t = useTranslations("admin.scim");
  const tCommon = useTranslations("common");
  const tGroups = useTranslations("admin.groups");
  const { data: config } = useClientQueries(schema).appConfig.useFindUnique({
    where: { key: SCIM_DEFAULT_MAPPED_ACCESS_KEY },
  });
  const upsert = useClientQueries(schema).appConfig.useUpsert();
  const [selectedAccess, setSelectedAccess] = useState<string>("NONE");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingAccess, setPendingAccess] = useState<string | null>(null);
  const [downgradedUsers, setDowngradedUsers] = useState<DowngradedUser[]>([]);

  useEffect(() => {
    const value = config?.value;
    if (typeof value === "string") setSelectedAccess(value);
    else setSelectedAccess("NONE");
  }, [config?.value]);

  const applyFallbackDefault = async (access: string) => {
    await upsert.mutateAsync({
      where: { key: SCIM_DEFAULT_MAPPED_ACCESS_KEY },
      create: { key: SCIM_DEFAULT_MAPPED_ACCESS_KEY, value: access },
      update: { value: access },
    });
    await enqueueFallbackDefaultRecompute();
    toast.success(t("fallbackDefaultSaved"));
  };

  const handleSave = async () => {
    const preview = await previewFallbackDefaultChange(
      selectedAccess === "NONE" ? null : (selectedAccess as Access)
    );
    if (!preview.success) {
      toast.error(preview.error);
      return;
    }
    if (preview.downgraded.length > 0) {
      setDowngradedUsers(preview.downgraded);
      setPendingAccess(selectedAccess);
      setConfirmOpen(true);
      return;
    }
    await applyFallbackDefault(selectedAccess);
  };

  return (
    <Card className="mt-6" data-testid="scim-fallback-default-card">
      <CardHeader>
        <CardTitle>{t("fallbackDefaultTitle")}</CardTitle>
        <CardDescription>{t("fallbackDefaultDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 max-w-md">
          <Select
            value={selectedAccess}
            onValueChange={setSelectedAccess}
            disabled={upsert.isPending}
          >
            <SelectTrigger
              data-testid="fallback-default-select"
              aria-label={t("fallbackDefaultLabel")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">{tCommon("access.none")}</SelectItem>
              <SelectItem value="USER">{tCommon("access.user")}</SelectItem>
              <SelectItem value="PROJECTADMIN">
                {tCommon("access.projectAdmin")}
              </SelectItem>
              <SelectItem value="ADMIN">{tCommon("access.admin")}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={upsert.isPending}
            data-testid="fallback-default-save"
          >
            {tCommon("actions.save")}
          </Button>
        </div>
      </CardContent>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {tGroups("downgradeConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {tGroups("downgradeConfirmDescription", {
                count: downgradedUsers.length,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="text-sm space-y-1 max-h-48 overflow-y-auto px-6">
            {downgradedUsers.map((u) => (
              <li
                key={u.userId}
                className="flex items-center justify-between gap-3"
              >
                <UserNameCell userId={u.userId} hideLink={true} />
                <span className="text-muted-foreground whitespace-nowrap">
                  {tGroups("downgradeConfirmAccessChange", {
                    from: u.currentAccess,
                    to: u.newAccess,
                  })}
                </span>
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setConfirmOpen(false);
                if (pendingAccess !== null) {
                  await applyFallbackDefault(pendingAccess);
                }
              }}
            >
              {tGroups("downgradeConfirmApplyAnyway")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function ScimTokensList() {
  const t = useTranslations("admin.scim");
  const tApiTokens = useTranslations("admin.apiTokens");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const { data: session, status } = useSession();
  const router = useRouter();
  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({
    column: "lastUsedAt",
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

  const sortField = sortConfig
    ? columnToFieldMap[sortConfig.column] || sortConfig.column
    : "lastUsedAt";

  const { mutateAsync: updateScimToken } =
    useClientQueries(schema).scimToken.useUpdate();

  // Stabilize mutation ref — ZenStack's mutateAsync changes identity every render
  const updateScimTokenRef = useRef(updateScimToken);
  useEffect(() => {
    updateScimTokenRef.current = updateScimToken;
  });

  const {
    data: tokens,
    isLoading,
    refetch: refetchTokens,
  } = useClientQueries(schema).scimToken.useFindMany(
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
          <div className="flex flex-row items-start justify-between gap-4">
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
                      storageKey="admin-scim-tokens"
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

            {tokens && tokens.length > 0 && (
              <p className="text-sm text-muted-foreground shrink-0">
                {tGlobal("admin.auditLogs.showing", {
                  loaded: tokens.length.toLocaleString(),
                  total: tokens.length.toLocaleString(),
                })}
              </p>
            )}
          </div>

          <div className="mt-4 w-full" data-testid="scim-table">
            <VirtualizedDataTable
              fillViewport
              columns={columns as any}
              data={(tokens ?? []) as ExtendedScimToken[]}
              onSortChange={handleSortChange}
              sortConfig={sortConfig}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
              isLoading={isLoading}
              resetKey={`${debouncedSearchString}|${showRevokedTokens}|${sortConfig.column}|${sortConfig.direction}`}
              testIdPrefix="admin-scim-table"
              rowTestIdPrefix="admin-scim-row"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("conflicts.title")}</CardTitle>
          <CardDescription>{t("conflicts.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ConflictLogTable />
        </CardContent>
      </Card>

      <FallbackDefaultCard />

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
