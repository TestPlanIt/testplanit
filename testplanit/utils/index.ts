import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export * from "./permissions";
export * from "./stringUtils";
export type { ClassValue };

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function randomElement(array: Array<any>) {
  return array[Math.floor(Math.random() * array.length)];
}
