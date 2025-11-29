import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export type { ClassValue };

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function randomElement(array: Array<any>) {
  return array[Math.floor(Math.random() * array.length)];
}

export * from "./cssVar";
export * from "./getConnectionText";
export * from "./getRenderContainer";
export * from "./isCustomNodeSelected";
export * from "./isTextSelected";
export * from "./permissions";
export * from "./stringUtils";
