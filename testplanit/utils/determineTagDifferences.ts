import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function determineTagDifferences(current: string[], previous: string[]) {
  // If it's the first version, all tags are "added"
  if (!previous || previous.length === 0) {
    return {
      addedTags: current,
      removedTags: [],
      tCommonTags: [],
    };
  }

  // For subsequent versions
  const addedTags = current.filter((tag) => !previous.includes(tag));
  const removedTags = previous.filter((tag) => !current.includes(tag));
  const tCommonTags = current.filter((tag) => previous.includes(tag));

  return { addedTags, removedTags, tCommonTags };
}
