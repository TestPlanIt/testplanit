"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  KeyRound,
  Plus,
  Trash2,
  Copy,
  Check,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { useFindManyApiToken, useDeleteApiToken } from "~/lib/hooks";
import { DateFormatter } from "@/components/DateFormatter";
import { useSession } from "next-auth/react";

interface ApiTokenSettingsProps {
  userId: string;
  isOwnProfile: boolean;
  isAdmin?: boolean;
}

interface NewTokenData {
  id: string;
  name: string;
  token: string;
  tokenPrefix: string;
  createdAt: string;
  expiresAt: string | null;
}

export function ApiTokenSettings({
  userId,
  isOwnProfile,
  isAdmin = false,
}: ApiTokenSettingsProps) {
  const t = useTranslations("users.profile.apiTokens");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [tokenToDelete, setTokenToDelete] = useState<string | null>(null);
  const [newTokenName, setNewTokenName] = useState("");
  const [newTokenExpiry, setNewTokenExpiry] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [newToken, setNewToken] = useState<NewTokenData | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: tokens, refetch: refetchTokens } = useFindManyApiToken({
    where: { userId, isActive: true },
    orderBy: { createdAt: "desc" },
  });

  const deleteToken = useDeleteApiToken();

  async function handleCreateToken() {
    if (!newTokenName.trim()) {
      setError(t("errors.nameRequired"));
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/api-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newTokenName.trim(),
          expiresAt: newTokenExpiry || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create token");
      }

      setNewToken(data);
      refetchTokens();
      // Invalidate the query cache for API tokens
      queryClient.invalidateQueries({ queryKey: ["ApiToken"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create token");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDeleteToken() {
    if (!tokenToDelete) return;

    setIsLoading(true);
    try {
      await deleteToken.mutateAsync({
        where: { id: tokenToDelete },
      });
      refetchTokens();
      setIsDeleteOpen(false);
      setTokenToDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete token");
    } finally {
      setIsLoading(false);
    }
  }

  function copyToken() {
    if (newToken?.token) {
      navigator.clipboard.writeText(newToken.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function closeCreateDialog() {
    setIsCreateOpen(false);
    setNewTokenName("");
    setNewTokenExpiry("");
    setNewToken(null);
    setError("");
  }

  function openDeleteDialog(tokenId: string) {
    setTokenToDelete(tokenId);
    setIsDeleteOpen(true);
  }

  // Only show for own profile or admin viewing another user
  if (!isOwnProfile && !isAdmin) {
    return null;
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">
              {tGlobal("admin.menu.apiTokens")}
            </span>
          </div>
          {isOwnProfile && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsCreateOpen(true)}
            >
              <Plus className="h-3 w-3" />
              {t("create")}
            </Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">{t("description")}</p>

        {tokens && tokens.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tGlobal("common.name")}</TableHead>
                <TableHead>{tGlobal("common.fields.token")}</TableHead>
                <TableHead>{tGlobal("common.fields.created")}</TableHead>
                <TableHead>
                  {tGlobal("admin.apiTokens.columns.lastUsed")}
                </TableHead>
                <TableHead>
                  {tGlobal("admin.apiTokens.columns.expires")}
                </TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.map((token) => (
                <TableRow key={token.id}>
                  <TableCell className="font-medium">{token.name}</TableCell>
                  <TableCell>
                    <code className="bg-muted px-2 py-1 rounded text-xs">
                      {token.tokenPrefix}
                      {"••••••••"}
                    </code>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <DateFormatter
                      date={token.createdAt}
                      formatString={`${session?.user?.preferences?.dateFormat ?? "MM_DD_YYYY_DASH"} ${session?.user?.preferences?.timeFormat ?? "HH_MM_A"}`}
                      timezone={session?.user?.preferences?.timezone}
                    />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {token.lastUsedAt ? (
                      <DateFormatter
                        date={token.lastUsedAt}
                        formatString={`${session?.user?.preferences?.dateFormat ?? "MM_DD_YYYY_DASH"} ${session?.user?.preferences?.timeFormat ?? "HH_MM_A"}`}
                        timezone={session?.user?.preferences?.timezone}
                      />
                    ) : (
                      <span className="text-muted-foreground/50">
                        {tGlobal("admin.apiTokens.lastUsedNever")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {token.expiresAt ? (
                      <Badge
                        variant={
                          new Date(token.expiresAt) < new Date()
                            ? "destructive"
                            : "secondary"
                        }
                      >
                        <DateFormatter
                          date={token.expiresAt}
                          formatString={session?.user?.preferences?.dateFormat}
                          timezone={session?.user?.preferences?.timezone}
                        />
                      </Badge>
                    ) : (
                      <Badge variant="outline">
                        {tGlobal("admin.apiTokens.lastUsedNever")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openDeleteDialog(token.id)}
                      className="h-8 w-8 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="text-center py-6 text-sm text-muted-foreground">
            {t("noTokens")}
          </div>
        )}
      </div>

      {/* Create Token Dialog */}
      <Dialog
        open={isCreateOpen}
        onOpenChange={(open) => !open && closeCreateDialog()}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {newToken ? t("tokenCreated") : t("createTitle")}
            </DialogTitle>
            <DialogDescription>
              {newToken ? t("tokenCreatedDescription") : t("createDescription")}
            </DialogDescription>
          </DialogHeader>

          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive rounded-md">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {!newToken ? (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="token-name">{t("nameLabel")}</Label>
                <Input
                  id="token-name"
                  placeholder={t("namePlaceholder")}
                  value={newTokenName}
                  onChange={(e) => setNewTokenName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="token-expiry">{t("expiryLabel")}</Label>
                <Input
                  id="token-expiry"
                  type="date"
                  value={newTokenExpiry}
                  onChange={(e) => setNewTokenExpiry(e.target.value)}
                  min={new Date().toISOString().split("T")[0]}
                />
                <p className="text-xs text-muted-foreground">
                  {t("expiryHint")}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-2 p-3 rounded-lg border border-destructive/50 text-destructive text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{t("copyWarning")}</span>
              </div>
              <div className="space-y-2">
                <Label>{t("yourToken")}</Label>
                <div className="flex gap-2">
                  <code className="flex-1 bg-muted px-3 py-2 rounded text-sm font-mono break-all">
                    {newToken.token}
                  </code>
                  <Button variant="outline" size="icon" onClick={copyToken}>
                    {copied ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            {!newToken ? (
              <>
                <Button variant="outline" onClick={closeCreateDialog}>
                  {tCommon("cancel")}
                </Button>
                <Button
                  onClick={handleCreateToken}
                  disabled={isLoading || !newTokenName.trim()}
                >
                  {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t("create")}
                </Button>
              </>
            ) : (
              <Button onClick={closeCreateDialog} className="w-full">
                {tCommon("actions.done")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={isDeleteOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsDeleteOpen(false);
            setTokenToDelete(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteToken}
              disabled={isLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {tCommon("actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
