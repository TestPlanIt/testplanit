/**
 * Lightweight Prisma client for workers and services that don't need ES sync extensions.
 * This avoids loading heavy dependencies and creating multiple PrismaClient instances.
 *
 * Use this for:
 * - Workers (forecastWorker, syncWorker, etc.)
 * - Services called by workers (forecastService, issueSearch, etc.)
 * - Integration adapters and managers
 *
 * Use lib/prisma.ts for:
 * - Next.js app routes and server actions (needs ES sync extensions)
 */

import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaBase: PrismaClient | undefined;
}

let prismaClient: PrismaClient;

if (process.env.NODE_ENV === "production") {
  prismaClient = new PrismaClient({
    errorFormat: "pretty",
  });
} else {
  // In development, reuse the client to avoid too many connections
  if (!global.prismaBase) {
    global.prismaBase = new PrismaClient({
      errorFormat: "colorless",
    });
  }
  prismaClient = global.prismaBase;
}

export const prisma = prismaClient;
