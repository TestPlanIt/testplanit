// ~/types/Workflows.ts

import { Workflows } from "@prisma/client";

interface DataRow {
  id: number;
  isActive?: boolean;
}

export interface ExtendedWorkflows extends DataRow, Workflows {
  icon: {
    id: number;
    name: string;
  };
  color: {
    id: number;
    value: string;
  };
  projects: {
    projectId: number;
    project: {
      name: string;
    };
  }[];
}
