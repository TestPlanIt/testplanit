import { Skeleton } from "@/components/ui/skeleton";

export const SkeletonRow = () => {
  return (
    <div className="flex space-x-4 p-2 border-accent">
      <Skeleton className="h-6 w-full" />
    </div>
  );
};
