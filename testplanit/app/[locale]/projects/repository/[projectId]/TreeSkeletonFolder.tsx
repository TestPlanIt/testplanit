import { Skeleton } from "@/components/ui/skeleton";

export const SkeletonRow = () => {
  return (
    <div className="flex space-x-4 border-accent p-2">
      <Skeleton className="h-6 w-full" />
    </div>
  );
};
