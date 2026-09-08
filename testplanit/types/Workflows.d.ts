// ~/types/Workflows.ts

import type { Workflows } from "~/zenstack/models";

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
  _count: {
    projects: number;
  };
}
