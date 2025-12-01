import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  performOptimisticUpdate,
  performOptimisticDelete,
  performOptimisticReorder,
  performOptimisticCreate,
  useOptimisticMutation,
  invalidateModelQueries,
  performZenStackOptimisticDelete,
} from "./optimistic-updates";

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("optimistic-updates", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  afterEach(() => {
    queryClient.clear();
  });

  describe("performOptimisticUpdate", () => {
    const queryKey = ["test", "data"];

    it("should optimistically update data and call mutation", async () => {
      const initialData = { value: 1 };
      queryClient.setQueryData(queryKey, initialData);

      const mutationFn = vi.fn().mockResolvedValue({ value: 2 });
      const updater = vi.fn().mockReturnValue({ value: 2 });

      await performOptimisticUpdate({
        queryClient,
        queryKey,
        mutationFn,
        updater,
      });

      expect(mutationFn).toHaveBeenCalled();
      expect(updater).toHaveBeenCalled();
    });

    it("should show success toast when successMessage is provided", async () => {
      const mutationFn = vi.fn().mockResolvedValue({ value: 2 });
      const updater = vi.fn().mockReturnValue({ value: 2 });

      await performOptimisticUpdate({
        queryClient,
        queryKey,
        mutationFn,
        updater,
        successMessage: "Updated successfully!",
      });

      expect(toast.success).toHaveBeenCalledWith("Updated successfully!");
    });

    it("should not show success toast when successMessage is not provided", async () => {
      const mutationFn = vi.fn().mockResolvedValue({ value: 2 });
      const updater = vi.fn().mockReturnValue({ value: 2 });

      await performOptimisticUpdate({
        queryClient,
        queryKey,
        mutationFn,
        updater,
      });

      expect(toast.success).not.toHaveBeenCalled();
    });

    it("should call onSuccess callback after successful mutation", async () => {
      const mutationFn = vi.fn().mockResolvedValue({ value: 2 });
      const updater = vi.fn().mockReturnValue({ value: 2 });
      const onSuccess = vi.fn();

      await performOptimisticUpdate({
        queryClient,
        queryKey,
        mutationFn,
        updater,
        onSuccess,
      });

      expect(onSuccess).toHaveBeenCalled();
    });

    it("should rollback on error and show error toast", async () => {
      const initialData = { value: 1 };
      queryClient.setQueryData(queryKey, initialData);

      const mutationFn = vi.fn().mockRejectedValue(new Error("Mutation failed"));
      const updater = vi.fn().mockReturnValue({ value: 2 });

      await expect(
        performOptimisticUpdate({
          queryClient,
          queryKey,
          mutationFn,
          updater,
        })
      ).rejects.toThrow("Mutation failed");

      expect(toast.error).toHaveBeenCalledWith("Operation failed. Please try again.");
      expect(queryClient.getQueryData(queryKey)).toEqual(initialData);
    });

    it("should use custom error message when provided", async () => {
      const mutationFn = vi.fn().mockRejectedValue(new Error("Mutation failed"));
      const updater = vi.fn().mockReturnValue({ value: 2 });

      await expect(
        performOptimisticUpdate({
          queryClient,
          queryKey,
          mutationFn,
          updater,
          errorMessage: "Custom error message",
        })
      ).rejects.toThrow();

      expect(toast.error).toHaveBeenCalledWith("Custom error message");
    });

    it("should call onError callback on failure", async () => {
      const initialData = { value: 1 };
      queryClient.setQueryData(queryKey, initialData);

      const mutationFn = vi.fn().mockRejectedValue(new Error("Mutation failed"));
      const updater = vi.fn().mockReturnValue({ value: 2 });
      const onError = vi.fn();

      await expect(
        performOptimisticUpdate({
          queryClient,
          queryKey,
          mutationFn,
          updater,
          onError,
        })
      ).rejects.toThrow();

      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.anything(),
        { previousData: initialData }
      );
    });

    it("should cancel outgoing queries before update", async () => {
      const cancelSpy = vi.spyOn(queryClient, "cancelQueries");
      const mutationFn = vi.fn().mockResolvedValue({});
      const updater = vi.fn().mockReturnValue({});

      await performOptimisticUpdate({
        queryClient,
        queryKey,
        mutationFn,
        updater,
      });

      expect(cancelSpy).toHaveBeenCalledWith({ queryKey });
    });
  });

  describe("performOptimisticDelete", () => {
    const queryKey = ["items"];

    it("should optimistically remove item from list", async () => {
      const initialData = [{ id: 1 }, { id: 2 }, { id: 3 }];
      queryClient.setQueryData(queryKey, initialData);

      const deleteFn = vi.fn().mockResolvedValue(undefined);
      const getId = vi.fn().mockReturnValue(2);
      const filterDeleted = vi.fn().mockImplementation((items, id) =>
        items.filter((item: any) => item.id !== id)
      );

      await performOptimisticDelete({
        queryClient,
        queryKey,
        deleteFn,
        getId,
        filterDeleted,
      });

      expect(deleteFn).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith("Deleted successfully");
    });

    it("should show custom success message", async () => {
      queryClient.setQueryData(queryKey, [{ id: 1 }]);

      const deleteFn = vi.fn().mockResolvedValue(undefined);
      const getId = vi.fn().mockReturnValue(1);
      const filterDeleted = vi.fn().mockReturnValue([]);

      await performOptimisticDelete({
        queryClient,
        queryKey,
        deleteFn,
        getId,
        filterDeleted,
        successMessage: "Item removed!",
      });

      expect(toast.success).toHaveBeenCalledWith("Item removed!");
    });

    it("should rollback on error", async () => {
      const initialData = [{ id: 1 }, { id: 2 }];
      queryClient.setQueryData(queryKey, initialData);

      const deleteFn = vi.fn().mockRejectedValue(new Error("Delete failed"));
      const getId = vi.fn().mockReturnValue(1);
      const filterDeleted = vi.fn().mockImplementation((items, id) =>
        items.filter((item: any) => item.id !== id)
      );

      await expect(
        performOptimisticDelete({
          queryClient,
          queryKey,
          deleteFn,
          getId,
          filterDeleted,
        })
      ).rejects.toThrow("Delete failed");

      expect(toast.error).toHaveBeenCalledWith("Failed to delete. Please try again.");
      expect(queryClient.getQueryData(queryKey)).toEqual(initialData);
    });

    it("should use custom error message", async () => {
      queryClient.setQueryData(queryKey, [{ id: 1 }]);

      const deleteFn = vi.fn().mockRejectedValue(new Error("Delete failed"));
      const getId = vi.fn().mockReturnValue(1);
      const filterDeleted = vi.fn().mockReturnValue([]);

      await expect(
        performOptimisticDelete({
          queryClient,
          queryKey,
          deleteFn,
          getId,
          filterDeleted,
          errorMessage: "Could not remove item",
        })
      ).rejects.toThrow();

      expect(toast.error).toHaveBeenCalledWith("Could not remove item");
    });

    it("should handle empty previousData", async () => {
      // No data set in queryClient
      const deleteFn = vi.fn().mockResolvedValue(undefined);
      const getId = vi.fn().mockReturnValue(1);
      const filterDeleted = vi.fn();

      await performOptimisticDelete({
        queryClient,
        queryKey,
        deleteFn,
        getId,
        filterDeleted,
      });

      expect(deleteFn).toHaveBeenCalled();
    });
  });

  describe("performOptimisticReorder", () => {
    const queryKey = ["sortable-items"];

    it("should optimistically update order", async () => {
      const initialData = [{ id: 1 }, { id: 2 }, { id: 3 }];
      queryClient.setQueryData(queryKey, initialData);

      const reorderedItems = [{ id: 3 }, { id: 1 }, { id: 2 }];
      const reorderFn = vi.fn().mockResolvedValue(undefined);

      await performOptimisticReorder({
        queryClient,
        queryKey,
        reorderFn,
        items: reorderedItems,
      });

      expect(reorderFn).toHaveBeenCalledWith(reorderedItems);
      expect(queryClient.getQueryData(queryKey)).toEqual(reorderedItems);
      expect(toast.success).toHaveBeenCalledWith("Reordered successfully");
    });

    it("should show custom success message", async () => {
      const reorderFn = vi.fn().mockResolvedValue(undefined);

      await performOptimisticReorder({
        queryClient,
        queryKey,
        reorderFn,
        items: [],
        successMessage: "Order saved!",
      });

      expect(toast.success).toHaveBeenCalledWith("Order saved!");
    });

    it("should rollback on error", async () => {
      const initialData = [{ id: 1 }, { id: 2 }];
      queryClient.setQueryData(queryKey, initialData);

      const reorderedItems = [{ id: 2 }, { id: 1 }];
      const reorderFn = vi.fn().mockRejectedValue(new Error("Reorder failed"));

      await expect(
        performOptimisticReorder({
          queryClient,
          queryKey,
          reorderFn,
          items: reorderedItems,
        })
      ).rejects.toThrow("Reorder failed");

      expect(toast.error).toHaveBeenCalledWith("Failed to reorder. Please try again.");
      expect(queryClient.getQueryData(queryKey)).toEqual(initialData);
    });

    it("should use custom error message", async () => {
      const reorderFn = vi.fn().mockRejectedValue(new Error("Reorder failed"));

      await expect(
        performOptimisticReorder({
          queryClient,
          queryKey,
          reorderFn,
          items: [],
          errorMessage: "Could not save order",
        })
      ).rejects.toThrow();

      expect(toast.error).toHaveBeenCalledWith("Could not save order");
    });
  });

  describe("performOptimisticCreate", () => {
    const queryKey = ["items"];

    it("should add temporary item and replace with real item on success", async () => {
      const initialData = [{ id: 1 }];
      queryClient.setQueryData(queryKey, initialData);

      const newItem = { id: 2, name: "New Item" };
      const createFn = vi.fn().mockResolvedValue(newItem);

      const result = await performOptimisticCreate({
        queryClient,
        queryKey,
        createFn,
        tempId: "temp-123",
      });

      expect(result).toEqual(newItem);
      expect(toast.success).toHaveBeenCalledWith("Created successfully");

      const finalData = queryClient.getQueryData(queryKey) as any[];
      expect(finalData).toContainEqual(newItem);
      expect(finalData.find((item) => item.id === "temp-123")).toBeUndefined();
    });

    it("should show custom success message", async () => {
      queryClient.setQueryData(queryKey, []);

      const createFn = vi.fn().mockResolvedValue({ id: 1 });

      await performOptimisticCreate({
        queryClient,
        queryKey,
        createFn,
        successMessage: "Item added!",
      });

      expect(toast.success).toHaveBeenCalledWith("Item added!");
    });

    it("should rollback on error", async () => {
      const initialData = [{ id: 1 }];
      queryClient.setQueryData(queryKey, initialData);

      const createFn = vi.fn().mockRejectedValue(new Error("Create failed"));

      await expect(
        performOptimisticCreate({
          queryClient,
          queryKey,
          createFn,
        })
      ).rejects.toThrow("Create failed");

      expect(toast.error).toHaveBeenCalledWith("Failed to create. Please try again.");
      expect(queryClient.getQueryData(queryKey)).toEqual(initialData);
    });

    it("should use custom error message", async () => {
      queryClient.setQueryData(queryKey, []);

      const createFn = vi.fn().mockRejectedValue(new Error("Create failed"));

      await expect(
        performOptimisticCreate({
          queryClient,
          queryKey,
          createFn,
          errorMessage: "Could not add item",
        })
      ).rejects.toThrow();

      expect(toast.error).toHaveBeenCalledWith("Could not add item");
    });

    it("should generate tempId when not provided", async () => {
      queryClient.setQueryData(queryKey, []);

      const createFn = vi.fn().mockResolvedValue({ id: 1 });

      await performOptimisticCreate({
        queryClient,
        queryKey,
        createFn,
      });

      expect(createFn).toHaveBeenCalled();
    });

    it("should handle undefined initial data", async () => {
      const createFn = vi.fn().mockResolvedValue({ id: 1 });

      await performOptimisticCreate({
        queryClient,
        queryKey,
        createFn,
      });

      const data = queryClient.getQueryData(queryKey) as any[];
      expect(data).toContainEqual({ id: 1 });
    });
  });

  describe("useOptimisticMutation", () => {
    const queryKey = ["test"];

    it("should return a mutate function", () => {
      const mutationFn = vi.fn().mockResolvedValue({});
      const updater = vi.fn().mockReturnValue({});

      const { mutate } = useOptimisticMutation({
        queryClient,
        queryKey,
        mutationFn,
        updater,
      });

      expect(typeof mutate).toBe("function");
    });

    it("should call mutationFn with variables when mutate is called", async () => {
      const mutationFn = vi.fn().mockResolvedValue({ updated: true });
      const updater = vi.fn().mockReturnValue({ updated: true });

      const { mutate } = useOptimisticMutation({
        queryClient,
        queryKey,
        mutationFn,
        updater,
      });

      await mutate({ id: 1, name: "test" });

      expect(mutationFn).toHaveBeenCalledWith({ id: 1, name: "test" });
    });
  });

  describe("invalidateModelQueries", () => {
    it("should invalidate queries matching model name", async () => {
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      await invalidateModelQueries(queryClient, "users");

      expect(invalidateSpy).toHaveBeenCalled();
    });

    it("should invalidate additional keys when provided", async () => {
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      await invalidateModelQueries(queryClient, "users", [
        ["extra", "key1"],
        ["extra", "key2"],
      ]);

      // Should be called 3 times: once for model + twice for additional keys
      expect(invalidateSpy).toHaveBeenCalledTimes(3);
    });

    it("should not invalidate additional keys when not provided", async () => {
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      await invalidateModelQueries(queryClient, "users");

      // Should only be called once for the model
      expect(invalidateSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("performZenStackOptimisticDelete", () => {
    it("should delete and invalidate model queries", async () => {
      const deleteFn = vi.fn().mockResolvedValue(undefined);
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      await performZenStackOptimisticDelete({
        queryClient,
        modelName: "posts",
        deleteFn,
        successMessage: "Post deleted!",
      });

      expect(deleteFn).toHaveBeenCalled();
      expect(invalidateSpy).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith("Post deleted!");
    });

    it("should not show success toast when successMessage is not provided", async () => {
      const deleteFn = vi.fn().mockResolvedValue(undefined);

      await performZenStackOptimisticDelete({
        queryClient,
        modelName: "posts",
        deleteFn,
      });

      expect(toast.success).not.toHaveBeenCalled();
    });

    it("should call onSuccess callback after deletion", async () => {
      const deleteFn = vi.fn().mockResolvedValue(undefined);
      const onSuccess = vi.fn();

      await performZenStackOptimisticDelete({
        queryClient,
        modelName: "posts",
        deleteFn,
        onSuccess,
      });

      expect(onSuccess).toHaveBeenCalled();
    });

    it("should show error toast on failure", async () => {
      const deleteFn = vi.fn().mockRejectedValue(new Error("Delete failed"));

      await expect(
        performZenStackOptimisticDelete({
          queryClient,
          modelName: "posts",
          deleteFn,
        })
      ).rejects.toThrow("Delete failed");

      expect(toast.error).toHaveBeenCalledWith("Failed to delete. Please try again.");
    });

    it("should use custom error message", async () => {
      const deleteFn = vi.fn().mockRejectedValue(new Error("Delete failed"));

      await expect(
        performZenStackOptimisticDelete({
          queryClient,
          modelName: "posts",
          deleteFn,
          errorMessage: "Could not delete post",
        })
      ).rejects.toThrow();

      expect(toast.error).toHaveBeenCalledWith("Could not delete post");
    });

    it("should call onError callback on failure", async () => {
      const deleteFn = vi.fn().mockRejectedValue(new Error("Delete failed"));
      const onError = vi.fn();

      await expect(
        performZenStackOptimisticDelete({
          queryClient,
          modelName: "posts",
          deleteFn,
          onError,
        })
      ).rejects.toThrow();

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
