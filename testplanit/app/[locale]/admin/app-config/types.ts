import { AppConfig } from "@prisma/client";

export interface AppConfigRow extends AppConfig {
  id: string;
  name: string;
}
