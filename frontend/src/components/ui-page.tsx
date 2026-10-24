import Link from "next/link";
import { cn } from "cn";
import { Button, buttonVariants } from "@/components/ui/button";

/**
 * Shared page scaffolding — one consistent header, one consistent empty state.
 * Rule of thumb: every page answers three questions in the first 100px —
 * "what is this?", "why should I care?", and "what do I do next?".
 */

export function PageHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  /** One plain-language line that tells the user what to expect. */
  description?: string;
  /** Right-aligned page actions (buttons). */
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
      <div className="max-w-2xl">
        {eyebrow && (
          <p className="font-mono text-[11px] font-medium tracking-widest text-muted-foreground/70 uppercase">
            {eyebrow}
          </p>
        )}
        <h1 className="mt-1 text-2xl font-medium tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-2 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
  actionLabel,
  actionHref,
  onAction,
}: {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-border px-8 py-14 text-center">
      <span
        aria-hidden
        className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-lg text-white ring-1 ring-white/10"
      >
        {icon ?? "✦"}
      </span>
      <p className="mt-4 font-medium">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{hint}</p>}
      {actionLabel &&
        (actionHref ? (
          <Link href={actionHref} className={cn(buttonVariants({ className: "mt-5" }))}>
            {actionLabel}
          </Link>
        ) : (
          <Button variant="outline" className="mt-5" onClick={onAction}>
            {actionLabel}
          </Button>
        ))}
    </div>
  );
}

export function StatBlock({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-xl bg-card ring-1 ring-foreground/10 px-4 py-3">
      <p className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-medium tracking-tight">{value}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );
}
