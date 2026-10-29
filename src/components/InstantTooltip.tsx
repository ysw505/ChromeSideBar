import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Minimum gap kept between the tooltip and the viewport edges
const VIEWPORT_MARGIN = 8;
// Vertical gap between the anchor's bottom edge and the tooltip
const ANCHOR_GAP = 4;

interface InstantTooltipProps
{
  text: string;
  anchorRect: DOMRect;
}

/**
 * Label shown immediately (no native title delay) just below an anchor element.
 * Rendered into document.body so parent overflow/stacking cannot clip it.
 */
export const InstantTooltip = ({ text, anchorRect }: InstantTooltipProps) =>
{
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(anchorRect.left);

  // Measure our own width after paint and clamp left so the label stays inside the viewport
  useLayoutEffect(() =>
  {
    const node = tooltipRef.current;
    if (!node)
    {
      return;
    }
    const width = node.getBoundingClientRect().width;
    const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
    setLeft(Math.max(VIEWPORT_MARGIN, Math.min(anchorRect.left, maxLeft)));
  }, [text, anchorRect]);

  return createPortal(
    <div
      ref={tooltipRef}
      role="tooltip"
      style={{ position: 'fixed', top: anchorRect.bottom + ANCHOR_GAP, left }}
      className="pointer-events-none z-50 text-xs px-2 py-1 rounded shadow-md whitespace-nowrap max-w-[240px] truncate bg-gray-800 text-gray-50 dark:bg-gray-200 dark:text-gray-900"
    >
      {text}
    </div>,
    document.body
  );
};
