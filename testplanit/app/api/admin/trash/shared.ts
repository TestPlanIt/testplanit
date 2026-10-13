import { baseDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { authenticateApiToken } from "~/lib/api-token-auth";
import { enrichFromApiAuth } from "~/lib/auditContextWrappers";
import { getServerAuthSession } from "~/server/auth";
import { db } from "~/server/db";
import {
  trashItemTypeByName,
  trashItemTypes,
  TrashItemType,
} from "./itemTypes";

// Helper to check admin authentication (session or API token)
export async function checkAdminAuth(
  request: NextRequest
): Promise<{ error?: NextResponse; userId?: string }> {
  const session = await getServerAuthSession();
  let userId = session?.user?.id;
  let userAccess: string | undefined = session?.user?.access ?? undefined;

  if (!userId) {
    const apiAuth = await authenticateApiToken(request);
    if (!apiAuth.authenticated) {
      return {
        error: NextResponse.json(
          { error: apiAuth.error, code: apiAuth.errorCode },
          { status: 401 }
        ),
      };
    }
    userId = apiAuth.userId;
    userAccess = apiAuth.access;
    if (apiAuth.userId) {
      // Attribute restore/purge audit rows (CDC GUC actor) to the token owner.
      enrichFromApiAuth({
        userId: apiAuth.userId,
        userName: apiAuth.userName,
        userEmail: apiAuth.userEmail,
        scopes: apiAuth.scopes,
      });
    }
  }

  if (!userId) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (!userAccess) {
    const user = await baseDb.user.findUnique({
      where: { id: userId },
      select: { access: true },
    });
    userAccess = user?.access;
  }

  if (userAccess !== "ADMIN") {
    return {
      error: NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      ),
    };
  }

  return { userId };
}

export interface TrashModel extends TrashItemType {
  model: any;
}

// Resolves a public item type to its raw (policy-free, hook-free) delegate.
// Returns null for unknown types and for delegates the client does not expose.
export function getTrashModel(itemType: string): TrashModel | null {
  const entry = trashItemTypeByName[itemType];
  if (!entry) return null;
  const model = (db as unknown as Record<string, unknown>)[entry.delegate];
  if (!model) return null;
  return { ...entry, model };
}

export const itemTypeToModelMap: Record<string, any> = Object.fromEntries(
  trashItemTypes.map((entry) => [
    entry.itemType,
    (db as unknown as Record<string, unknown>)[entry.delegate],
  ])
);
