import React, { useState, useEffect, ComponentType, FC } from "react";
import dynamicIconImports from "lucide-react/dynamicIconImports";
import { LucideProps } from "lucide-react";
import LoadingSpinner from "./LoadingSpinner";
import { type ClassValue } from "~/utils";

interface IconProps {
  name: keyof typeof dynamicIconImports;
  className?: ClassValue;
  color?: string;
  size?: number | string;
  strokeWidth?: number | string;
  style?: React.CSSProperties;
}

// Cache to store dynamically loaded icon components
const iconCache = new Map<string, ComponentType<LucideProps>>();
const loadingPromises = new Map<string, Promise<void>>();

const loadIconToCache = async (
  name: keyof typeof dynamicIconImports
): Promise<void> => {
  if (iconCache.has(name)) {
    return;
  }

  // If this icon is already being loaded, wait for that promise
  if (loadingPromises.has(name)) {
    await loadingPromises.get(name);
    return;
  }

  // Create a new loading promise for this icon
  const loadPromise = (async () => {
    try {
      const iconModule = await dynamicIconImports[name]();
      const component = iconModule.default || iconModule;
      iconCache.set(name, component);
    } catch (err) {
      console.error(`Failed to load icon: ${name}`);
      throw err;
    } finally {
      loadingPromises.delete(name);
    }
  })();

  loadingPromises.set(name, loadPromise);
  await loadPromise;
};

const useDynamicIcon = (name: keyof typeof dynamicIconImports) => {
  const [IconComponent, setIconComponent] =
    useState<ComponentType<LucideProps> | null>(() => {
      // Initialize from cache if available
      return iconCache.get(name) || null;
    });
  const [isLoading, setIsLoading] = useState(() => {
    // Only start loading if not in cache
    return !iconCache.has(name);
  });

  useEffect(() => {
    let mounted = true;

    const loadIcon = async () => {
      // Skip if already in cache
      if (iconCache.has(name)) {
        if (mounted) {
          setIconComponent(iconCache.get(name) || null);
          setIsLoading(false);
        }
        return;
      }

      try {
        await loadIconToCache(name);
        if (mounted) {
          setIconComponent(iconCache.get(name) || null);
        }
      } catch (err) {
        if (mounted) {
          setIconComponent(null);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    loadIcon();

    return () => {
      mounted = false;
    };
  }, [name]);

  return { IconComponent, isLoading };
};

const DynamicIcon: FC<IconProps> = ({ name, color, className, size, strokeWidth, style }) => {
  const { IconComponent, isLoading } = useDynamicIcon(name);

  if (isLoading) {
    return <LoadingSpinner className={className} />;
  }

  if (!IconComponent) {
    return null;
  }

  return <IconComponent {...{ color, className, size, strokeWidth, style } as LucideProps} />;
};

export default DynamicIcon;
