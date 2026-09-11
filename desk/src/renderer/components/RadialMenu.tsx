/**
 * The orb's radial menu: Status, Packet, Log, Sync, opened on the station
 * ring at the four diagonals no station occupies (spec 2.2, 3.2). Closes on
 * outside click or Escape.
 */
import { useEffect, useRef } from 'react';
import { polar, MENU_ANGLES } from '@/lib/polar';

export interface RadialMenuItem {
  label: string;
  onSelect: () => void;
}

export interface RadialMenuProps {
  open: boolean;
  /** Centre and radius to open at -- pass the same values used for the station ring. */
  cx: number;
  cy: number;
  r: number;
  /** Up to four items, one per angle in MENU_ANGLES, in order. Extra items are not shown. */
  items: RadialMenuItem[];
  onClose: () => void;
  className?: string;
}

export function RadialMenu({ open, cx, cy, r, items, onClose, className }: RadialMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    }

    document.addEventListener('keydown', onKeyDown);
    // Capture phase so a click on the orb itself (which opens the menu) does
    // not also immediately close it via this same handler on the same tick.
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open, onClose]);

  if (!open) return null;

  const shown = items.slice(0, MENU_ANGLES.length);

  return (
    <div ref={rootRef} className={['radial-menu', className].filter(Boolean).join(' ')} role="menu">
      {shown.map((item, i) => {
        const { x, y } = polar(cx, cy, r, MENU_ANGLES[i]);
        return (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className="radial-menu-item label"
            style={{ left: x, top: y }}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
