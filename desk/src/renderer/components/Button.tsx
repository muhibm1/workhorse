/**
 * The app's one button primitive. Tone carries meaning (primary action,
 * amber for a gate/human action, ghost for secondary, danger for reject /
 * destructive); size is a layout knob only.
 */
import type { ButtonHTMLAttributes } from 'react';

export type ButtonTone = 'primary' | 'amber' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
  size?: ButtonSize;
}

export function Button({ tone = 'primary', size = 'md', className, type = 'button', ...rest }: ButtonProps) {
  const cls = ['btn', `btn-${tone}`, `btn-${size}`, className].filter(Boolean).join(' ');
  return <button type={type} className={cls} {...rest} />;
}
