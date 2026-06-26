/** 最小の共通 UI プリミティブ（Tailwind・light/dark 対応）。shadcn 導入時に差し替え可能。 */
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { HealthStatus } from '../../shared/domain.js';

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger';

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white',
  default: 'border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800',
  ghost: 'hover:bg-zinc-100 dark:hover:bg-zinc-800',
  danger: 'border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950',
};

export function Button({
  variant = 'default',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }): JSX.Element {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        buttonVariants[variant],
        className,
      )}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }): JSX.Element {
  return (
    <div className={cn('rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900', className)}>
      {children}
    </div>
  );
}

const healthColor: Record<HealthStatus, string> = {
  ok: 'text-green-500',
  error: 'text-red-500',
  unverified: 'text-amber-500',
};

export function HealthBadge({ health }: { health: HealthStatus }): JSX.Element {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className={healthColor[health]}>●</span>
      <span className="text-zinc-500">{t(`health.${health}`)}</span>
    </span>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{label}</span>
      {children}
      {hint && <span className="block text-xs text-zinc-400">{hint}</span>}
    </label>
  );
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return (
    <input
      {...props}
      className={cn(
        'w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:placeholder:text-zinc-600',
        className,
      )}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>): JSX.Element {
  return (
    <textarea
      {...props}
      className={cn(
        'w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:placeholder:text-zinc-600',
        className,
      )}
    />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>): JSX.Element {
  return (
    <select
      {...props}
      className={cn(
        'w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950',
        className,
      )}
    >
      {children}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50',
        checked ? 'bg-green-500' : 'bg-zinc-300 dark:bg-zinc-700',
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-base font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}
