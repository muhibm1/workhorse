/**
 * A small tone-coloured tag: verification state, tier, "Waiting On" (spec 2.1),
 * gate status.
 *
 * `@/lib/orbState` (T6) landed while this component was being written, so
 * `BadgeTone` is `RingTone` (its ring-colour union) widened with `'neutral'`
 * for an untoned badge, rather than a parallel literal union.
 */
import type { HTMLAttributes, ReactNode } from 'react';
import type { RingTone } from '@/lib/orbState';

export type BadgeTone = RingTone | 'neutral';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  children?: ReactNode;
  className?: string;
}

export function Badge({ tone = 'neutral', children, className, ...rest }: BadgeProps) {
  const cls = ['badge', `badge-${tone}`, className].filter(Boolean).join(' ');
  return (
    <span className={cls} {...rest}>
      {children}
    </span>
  );
}
