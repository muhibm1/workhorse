/**
 * A panel: the base chrome for cards, the gate index, and every other boxed surface. A rounded,
 * hairline-bordered card on the Dracula panel colour; this component only adds the optional
 * title row and the `active` accent border.
 */
import type { HTMLAttributes, ReactNode } from 'react';

export interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Rendered as an uppercase label above the body. Omit for a title-less panel. */
  title?: ReactNode;
  /** Draws the border in the accent colour, for the surface that currently wants attention. */
  active?: boolean;
  children?: ReactNode;
  className?: string;
}

export function Panel({ title, active = false, children, className, ...rest }: PanelProps) {
  const cls = ['panel', active ? 'panel-active' : '', className].filter(Boolean).join(' ');
  return (
    <div className={cls} {...rest}>
      {title !== undefined && <div className="panel-title label">{title}</div>}
      <div className="panel-body">{children}</div>
    </div>
  );
}
