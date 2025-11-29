import { PrismaClient } from "@prisma/client";

import dynamicIconImports from "lucide-react/dynamicIconImports";
import { ColumnDef } from "@tanstack/react-table";

export type IconName = keyof typeof dynamicIconImports;
