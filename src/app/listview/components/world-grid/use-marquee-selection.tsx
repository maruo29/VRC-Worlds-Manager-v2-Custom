'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Pointer travel before a press counts as a drag rather than a click. */
const DRAG_THRESHOLD_PX = 5;

/** Distance from an edge at which the list starts scrolling itself. */
const AUTO_SCROLL_MARGIN_PX = 48;
const AUTO_SCROLL_STEP_PX = 18;

interface Point {
  x: number;
  y: number;
}

interface MarqueeOptions {
  /** The grid element the cards live in. */
  gridRef: React.RefObject<HTMLDivElement | null>;
  enabled: boolean;
  /**
   * Called on every change while dragging. `additive` is true when the user
   * held Ctrl/Shift, meaning the rectangle adds to the previous selection.
   */
  onSelectionChange: (worldIds: string[], additive: boolean) => void;
  /** Called once, when a press turns into an actual drag. */
  onDragStart?: () => void;
}

function findScrollParent(element: HTMLElement | null): HTMLElement | null {
  let current: HTMLElement | null = element;
  while (current) {
    const { overflowY } = getComputedStyle(current);
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      current.scrollHeight > current.clientHeight
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * Rubber-band selection over the world grid.
 *
 * Coordinates are kept in viewport space so hit testing is a plain rectangle
 * intersection against each card, and only the drawn overlay is converted back
 * into the grid's own coordinates.
 */
export function useMarqueeSelection({
  gridRef,
  enabled,
  onSelectionChange,
  onDragStart,
}: MarqueeOptions) {
  const [rect, setRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const originRef = useRef<Point | null>(null);
  const currentRef = useRef<Point | null>(null);
  const additiveRef = useRef(false);
  const isDraggingRef = useRef(false);
  /** Read by the card click handler so a drag does not also open a world. */
  const didDragRef = useRef(false);
  const autoScrollRef = useRef<number | null>(null);
  /**
   * Ids picked up so far in this drag. The grid is virtualized, so a card the
   * rectangle already swept past is unmounted by the time the next pass runs -
   * recomputing from the DOM alone would silently drop it again.
   */
  const accumulatedRef = useRef<Set<string>>(new Set());

  const stopAutoScroll = useCallback(() => {
    if (autoScrollRef.current !== null) {
      window.clearInterval(autoScrollRef.current);
      autoScrollRef.current = null;
    }
  }, []);

  const applySelection = useCallback(() => {
    const grid = gridRef.current;
    const origin = originRef.current;
    const current = currentRef.current;
    if (!grid || !origin || !current) return;

    const left = Math.min(origin.x, current.x);
    const right = Math.max(origin.x, current.x);
    const top = Math.min(origin.y, current.y);
    const bottom = Math.max(origin.y, current.y);

    const rendered = new Set<string>();
    const insideRect = new Set<string>();
    grid.querySelectorAll<HTMLElement>('[data-world-card]').forEach((card) => {
      const worldId = card.dataset.worldCard;
      if (!worldId) return;
      rendered.add(worldId);
      const box = card.getBoundingClientRect();
      const intersects =
        box.left < right &&
        box.right > left &&
        box.top < bottom &&
        box.bottom > top;
      if (intersects) insideRect.add(worldId);
    });

    const accumulated = accumulatedRef.current;
    // Only a card that is on screen right now can be de-selected by shrinking
    // the rectangle; anything off screen keeps whatever it had.
    accumulated.forEach((worldId) => {
      if (rendered.has(worldId) && !insideRect.has(worldId)) {
        accumulated.delete(worldId);
      }
    });
    insideRect.forEach((worldId) => accumulated.add(worldId));

    onSelectionChange(Array.from(accumulated), additiveRef.current);

    const gridBox = grid.getBoundingClientRect();
    setRect({
      left: left - gridBox.left + grid.scrollLeft,
      top: top - gridBox.top + grid.scrollTop,
      width: right - left,
      height: bottom - top,
    });
  }, [gridRef, onSelectionChange]);

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!enabled || event.button !== 0) return;
      // Let the card's own controls (checkbox, status buttons) work normally.
      if ((event.target as HTMLElement).closest('[data-no-marquee]')) return;

      originRef.current = { x: event.clientX, y: event.clientY };
      currentRef.current = { x: event.clientX, y: event.clientY };
      additiveRef.current = event.ctrlKey || event.metaKey || event.shiftKey;
      isDraggingRef.current = false;
      didDragRef.current = false;
      accumulatedRef.current = new Set();
    },
    [enabled],
  );

  useEffect(() => {
    if (!enabled) return;

    const handleMouseMove = (event: MouseEvent) => {
      const origin = originRef.current;
      if (!origin) return;

      currentRef.current = { x: event.clientX, y: event.clientY };

      if (!isDraggingRef.current) {
        const travelled =
          Math.abs(event.clientX - origin.x) +
          Math.abs(event.clientY - origin.y);
        if (travelled < DRAG_THRESHOLD_PX) return;

        isDraggingRef.current = true;
        didDragRef.current = true;
        onDragStart?.();

        // Stop the browser from turning the drag into a text selection.
        document.body.style.userSelect = 'none';

        const scroller = findScrollParent(gridRef.current);
        if (scroller) {
          autoScrollRef.current = window.setInterval(() => {
            const point = currentRef.current;
            if (!point) return;
            const box = scroller.getBoundingClientRect();
            if (point.y < box.top + AUTO_SCROLL_MARGIN_PX) {
              scroller.scrollTop -= AUTO_SCROLL_STEP_PX;
              applySelection();
            } else if (point.y > box.bottom - AUTO_SCROLL_MARGIN_PX) {
              scroller.scrollTop += AUTO_SCROLL_STEP_PX;
              applySelection();
            }
          }, 30);
        }
      }

      applySelection();
    };

    const handleMouseUp = () => {
      const wasDragging = isDraggingRef.current;
      originRef.current = null;
      currentRef.current = null;
      isDraggingRef.current = false;
      stopAutoScroll();
      setRect(null);

      if (wasDragging) {
        document.body.style.userSelect = '';
        // Cleared on the next tick so the click that follows mouseup still
        // sees that a drag happened.
        window.setTimeout(() => {
          didDragRef.current = false;
        }, 0);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      stopAutoScroll();
      document.body.style.userSelect = '';
    };
  }, [enabled, applySelection, onDragStart, gridRef, stopAutoScroll]);

  return { handleMouseDown, marqueeRect: rect, didDragRef };
}
