import { useEffect, useState } from 'react';
import { Spinner } from '@phosphor-icons/react';
import { cn } from '@jybrd/design-system/lib/utils';

interface PageLoadingCoverProps {
  loading: boolean;
  pageName: string;
}

export function PageLoadingCover({ loading, pageName }: PageLoadingCoverProps) {
  const [visible, setVisible] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    if (!loading) {
      // Start fade out animation
      setFadeOut(true);
      // Remove from DOM after animation completes
      const timer = setTimeout(() => {
        setVisible(false);
      }, 300); // Match the CSS transition duration
      return () => clearTimeout(timer);
    } else {
      // Reset state when loading starts
      setVisible(true);
      setFadeOut(false);
    }
  }, [loading]);

  if (!visible) return null;

  return (
    <div
      className={cn(
        'absolute inset-0 z-50 flex items-center justify-center bg-background transition-opacity duration-300',
        fadeOut ? 'opacity-0' : 'opacity-100'
      )}
    >
      <div className="flex flex-col items-center gap-3">
        <Spinner className="h-8 w-8 animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">Loading {pageName}...</span>
      </div>
    </div>
  );
}
