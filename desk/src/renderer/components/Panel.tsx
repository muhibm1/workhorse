/**
 * A bracketed panel: the base chrome for cards, the Run stage, the gate index,
 * and every other boxed surface (spec 4.2). Corner brackets are the shared
 * `.bracket` utility from theme.css; this component only adds the optional
 * title row and the `active` -> `.bracket.active` wiring.
 */
import type { HTMLAttributes, ReactNode } from 'react';

export interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Rendered as an uppercase label above the body. Omit for a title-less panel. */
  title?: ReactNode;
  /** Brightens the corner brackets to --cyan, same as :focus-within does. */
  active?: boolean;
  children?: ReactNode;
  className?: string;
}

export function Panel({ title, active = false, children, className, ...rest }: PanelProps) {
  const cls = ['panel', 'bracket', active ? 'active' : '', className].filter(Boolean).join(' ');
  return (
    <div className={cls} {...rest}>
      {title !== undefined && <div className="panel-title label">{title}</div>}
      <div className="panel-body">{children}</div>
    </div>
  );
}
