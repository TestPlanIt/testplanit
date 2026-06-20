import type { AppConfig } from "~/zenstack/models";

export interface AppConfigRow extends AppConfig {
  id: string;
  name: string;
}
