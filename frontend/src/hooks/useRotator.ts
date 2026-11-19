import { useEffect, useRef, useState } from 'react';

interface RotatorOptions {
  /** Number of items to cycle through. */
  length: number;
  /** setInterval period in ms. */
  intervalMs: number;
  /** Delay between fade-out and swap + fade-in, in ms. */
  swapDelayMs: number;
  /** Item shown before the first swap (the originals don't always start at index 0). */
  initialShown: number;
  /** Whether the item is visible before the first swap. */
  initialVisible: boolean;
}

/**
 * Port of the Stitch "multilingual welcome" scripts:
 *   every `intervalMs`: fade out; after `swapDelayMs`: advance to the next item, fade in.
 * The internal counter starts at 0 (as in the originals), independent of `initialShown`.
 * Like the originals, it never starts when the user prefers reduced motion.
 */
export function useRotator({ length, intervalMs, swapDelayMs, initialShown, initialVisible }: RotatorOptions) {
  const [shown, setShown] = useState(initialShown);
  const [visible, setVisible] = useState(initialVisible);
  const counter = useRef(0);

  useEffect(() => {
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    const timeouts = new Set<number>();
    const interval = window.setInterval(() => {
      setVisible(false);
      const t = window.setTimeout(() => {
        timeouts.delete(t);
        counter.current = (counter.current + 1) % length;
        setShown(counter.current);
        setVisible(true);
      }, swapDelayMs);
      timeouts.add(t);
    }, intervalMs);
    return () => {
      window.clearInterval(interval);
      timeouts.forEach((t) => window.clearTimeout(t));
    };
  }, [length, intervalMs, swapDelayMs]);

  return { shown, visible };
}
