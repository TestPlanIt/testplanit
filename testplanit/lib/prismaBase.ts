// lib/prismaBase.ts
// Base Prisma client without Elasticsearch sync extensions
// Use this for workers and services that don't need auto-ES sync

import { PrismaClient } from "@prisma/client";

// Declare global types
declare global {
  var prismaBase: PrismaClient | undefined;
}

let prismaClient: PrismaClient;

// Create a simple PrismaClient without extensions
if (process.env.NODE_ENV === "production") {
  prismaClient = new PrismaClient({ errorFormat: "pretty" });
} else {
  // Reuse global instance in development to prevent hot-reload issues
  if (!global.prismaBase) {
    global.prismaBase = new PrismaClient({ errorFormat: "colorless" });
  }
  prismaClient = global.prismaBase;
}

export const prisma = prismaClient;
