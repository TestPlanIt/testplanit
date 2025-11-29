import { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export interface OptimisticUpdateOptions<TData, TVariables> {
  queryClient: QueryClient;
  queryKey: unknown[];
  mutationFn: (variables: TVariables) => Promise<TData>;
  updater: (old: TData | undefined, variables: TVariables) => TData;
  onError?: (error: Error, variables: TVariables, context: { previousData: TData | undefined }) => void;
  onSuccess?: (data: TData, variables: TVariables) => void;
  errorMessage?: string;
  successMessage?: string;
}

export async function performOptimisticUpdate<TData, TVariables>({
  queryClient,
  queryKey,
  mutationFn,
  updater,
  onError,
  onSuccess,
  errorMessage = "Operation failed. Please try again.",
  successMessage,
}: OptimisticUpdateOptions<TData, TVariables>) {
  // Cancel any outgoing refetches
  await queryClient.cancelQueries({ queryKey });

  // Snapshot the previous value
  const previousData = queryClient.getQueryData<TData>(queryKey);

  // Optimistically update to the new value
  queryClient.setQueryData<TData>(queryKey, (old) => updater(old, {} as TVariables));

  try {
    // Perform the mutation
    const result = await mutationFn({} as TVariables);
    
    if (successMessage) {
      toast.success(successMessage);
    }
    
    onSuccess?.(result, {} as TVariables);
    
    return result;
  } catch (error) {
    // If the mutation fails, use the context returned from onMutate to roll back
    queryClient.setQueryData(queryKey, previousData);
    
    toast.error(errorMessage);
    
    onError?.(error as Error, {} as TVariables, { previousData });
    
    throw error;
  }
}

export interface OptimisticDeleteOptions<TData, TId> {
  queryClient: QueryClient;
  queryKey: unknown[];
  deleteFn: () => Promise<void>;
  getId: () => TId;
  filterDeleted: (items: TData[], id: TId) => TData[];
  successMessage?: string;
  errorMessage?: string;
}

export async function performOptimisticDelete<TData, TId>({
  queryClient,
  queryKey,
  deleteFn,
  getId,
  filterDeleted,
  successMessage = "Deleted successfully",
  errorMessage = "Failed to delete. Please try again.",
}: OptimisticDeleteOptions<TData, TId>) {
  await queryClient.cancelQueries({ queryKey });

  const previousData = queryClient.getQueryData<TData[]>(queryKey);
  const idToDelete = getId();

  if (previousData) {
    queryClient.setQueryData<TData[]>(queryKey, (old) => 
      old ? filterDeleted(old, idToDelete) : []
    );
  }

  try {
    await deleteFn();
    if (successMessage) {
      toast.success(successMessage);
    }
  } catch (error) {
    queryClient.setQueryData(queryKey, previousData);
    toast.error(errorMessage);
    throw error;
  }
}

export interface OptimisticReorderOptions<TData> {
  queryClient: QueryClient;
  queryKey: unknown[];
  reorderFn: (items: TData[]) => Promise<void>;
  items: TData[];
  successMessage?: string;
  errorMessage?: string;
}

export async function performOptimisticReorder<TData>({
  queryClient,
  queryKey,
  reorderFn,
  items,
  successMessage = "Reordered successfully",
  errorMessage = "Failed to reorder. Please try again.",
}: OptimisticReorderOptions<TData>) {
  await queryClient.cancelQueries({ queryKey });

  const previousData = queryClient.getQueryData<TData[]>(queryKey);

  queryClient.setQueryData<TData[]>(queryKey, items);

  try {
    await reorderFn(items);
    if (successMessage) {
      toast.success(successMessage);
    }
  } catch (error) {
    queryClient.setQueryData(queryKey, previousData);
    toast.error(errorMessage);
    throw error;
  }
}

export interface OptimisticCreateOptions<TData, TVariables> {
  queryClient: QueryClient;
  queryKey: unknown[];
  createFn: (variables: TVariables) => Promise<TData>;
  tempId?: string | number;
  successMessage?: string;
  errorMessage?: string;
}

export async function performOptimisticCreate<TData extends { id?: string | number }, TVariables = any>({
  queryClient,
  queryKey,
  createFn,
  tempId = `temp-${Date.now()}`,
  successMessage = "Created successfully",
  errorMessage = "Failed to create. Please try again.",
}: OptimisticCreateOptions<TData, TVariables>) {
  await queryClient.cancelQueries({ queryKey });

  const previousData = queryClient.getQueryData<TData[]>(queryKey);
  
  const optimisticItem = { id: tempId } as unknown as TData;

  queryClient.setQueryData<TData[]>(queryKey, (old) => 
    old ? [...old, optimisticItem] : [optimisticItem]
  );

  try {
    const result = await createFn({} as TVariables);
    
    // Replace temp item with real item
    queryClient.setQueryData<TData[]>(queryKey, (old) =>
      old ? old.map(item => item.id === tempId ? result : item) : [result]
    );
    
    if (successMessage) {
      toast.success(successMessage);
    }
    return result;
  } catch (error) {
    queryClient.setQueryData(queryKey, previousData);
    toast.error(errorMessage);
    throw error;
  }
}

export function useOptimisticMutation<TData, TVariables>(
  options: OptimisticUpdateOptions<TData, TVariables>
) {
  return {
    mutate: async (variables: TVariables) => {
      return performOptimisticUpdate({
        ...options,
        mutationFn: () => options.mutationFn(variables),
        updater: (old) => options.updater(old, variables),
      });
    },
  };
}

// Helper to invalidate all related queries for a model
export async function invalidateModelQueries(
  queryClient: QueryClient,
  modelName: string,
  additionalKeys?: string[][]
) {
  // Invalidate the main model queries
  await queryClient.invalidateQueries({ 
    predicate: (query) => {
      const queryKey = query.queryKey as any[];
      return queryKey[0]?.includes?.(modelName);
    }
  });

  // Invalidate any additional specific queries
  if (additionalKeys) {
    await Promise.all(
      additionalKeys.map(key => 
        queryClient.invalidateQueries({ queryKey: key })
      )
    );
  }
}

// Simpler optimistic delete for ZenStack hooks
export async function performZenStackOptimisticDelete({
  queryClient,
  modelName,
  deleteFn,
  successMessage,
  errorMessage = "Failed to delete. Please try again.",
  onSuccess,
  onError,
}: {
  queryClient: QueryClient;
  modelName: string;
  deleteFn: () => Promise<void>;
  successMessage?: string;
  errorMessage?: string;
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}) {
  try {
    await deleteFn();
    
    // Invalidate all queries related to this model
    await invalidateModelQueries(queryClient, modelName);
    
    if (successMessage) {
      toast.success(successMessage);
    }
    
    onSuccess?.();
  } catch (error) {
    toast.error(errorMessage);
    onError?.(error as Error);
    throw error;
  }
}