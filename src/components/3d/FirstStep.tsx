import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../../i18n';

/**
 * How a newcomer learns to move on. Nothing is added to the page ahead of time:
 * the dot shows the way in its own language, and the keys show up where the
 * hand already is. All of it stops for good at the first real input.
 */

/** A key, drawn the way a keyboard hint is: hairline, mono, no fill. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="key">{children}</kbd>;
}

/**
 * On a desktop, before the first move, the pointer carries the hint over the
 * globe: one mono line beside the cursor, and nothing anywhere else. Where the
 * hand is, it speaks; where it is not, there is nothing.
 */
export function CursorHint({ active, next }: { active: boolean; next: string }) {
  const { language } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    if (!active) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const onMove = (e: PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      const target = e.target as Element | null;
      const onGlobe = Boolean(target?.closest?.('.canvas-container'));
      setOver(onGlobe);
      if (onGlobe) el.style.transform = `translate(${e.clientX + 18}px, ${e.clientY + 12}px)`;
    };
    const onLeave = () => setOver(false);
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, [active]);

  if (!active) return null;
  return (
    <div ref={ref} className={`first-hint${over ? ' is-on' : ''}`} aria-hidden="true">
      <span>{language === 'ko' ? '스크롤' : 'scroll'}</span>
      <span className="first-hint__sep">·</span>
      <Kbd>→</Kbd>
      <span>{next}</span>
    </div>
  );
}
