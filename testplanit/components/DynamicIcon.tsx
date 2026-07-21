import { LucideProps, Shapes } from "lucide-react";
import dynamicIconImports from "lucide-react/dynamicIconImports";
import React, { ComponentType, FC, useEffect, useState } from "react";
import { type ClassValue } from "~/utils";
import LoadingSpinner from "./LoadingSpinner";

interface IconProps {
  name: keyof typeof dynamicIconImports;
  className?: ClassValue;
  color?: string;
  size?: number | string;
  strokeWidth?: number | string;
  style?: React.CSSProperties;
}

// lucide removes/renames icons between releases (brand logos were dropped for
// trademark reasons, for example). Names chosen by users are persisted in the
// database, so a name can outlive the icon it points to. Guard against that:
// an unknown name renders a neutral fallback instead of throwing, and consumers
// (e.g. the icon picker) can avoid offering icons that no longer exist.
export const isKnownIconName = (
  name: string
): name is keyof typeof dynamicIconImports =>
  Object.prototype.hasOwnProperty.call(dynamicIconImports, name);

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
    // Only start loading if the icon exists and isn't already cached
    return isKnownIconName(name) && !iconCache.has(name);
  });

  useEffect(() => {
    let mounted = true;

    // Unknown icon (e.g. removed from the installed lucide version) — skip the
    // dynamic import entirely and let DynamicIcon render its fallback quietly.
    if (!isKnownIconName(name)) {
      if (mounted) {
        setIconComponent(null);
        setIsLoading(false);
      }
      return () => {
        mounted = false;
      };
    }

    const loadIcon = async () => {
      // Skip if already in cache
      if (iconCache.has(name)) {
        if (mounted) {
          setIconComponent(iconCache.get(name) || null);
          setIsLoading(false);
        }
        return;
      }

      if (mounted) {
        setIsLoading(true);
      }

      try {
        await loadIconToCache(name);
        if (mounted) {
          setIconComponent(iconCache.get(name) || null);
        }
      } catch {
        if (mounted) {
          setIconComponent(null);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    void loadIcon();

    return () => {
      mounted = false;
    };
  }, [name]);

  return { IconComponent, isLoading };
};

const DynamicIcon: FC<IconProps> = ({
  name,
  color,
  className,
  size,
  strokeWidth,
  style,
}) => {
  const { IconComponent, isLoading } = useDynamicIcon(name);

  if (isLoading) {
    return <LoadingSpinner className={className} />;
  }

  // Fall back to a neutral glyph when the requested icon can't be resolved
  // (removed/renamed in the installed lucide version) so the slot never renders
  // blank and the user's stored selection is preserved rather than destroyed.
  const Icon = IconComponent ?? Shapes;

  return (
    <Icon
      {...({ color, className, size, strokeWidth, style } as LucideProps)}
    />
  );
};

export default DynamicIcon;
