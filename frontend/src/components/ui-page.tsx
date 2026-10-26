import Link from "next/link";
import { cn } from "cn";
import { Button, buttonVariants } from "@/components/ui/button";

/**
 * Shared page scaffolding — one consistent header, one consistent empty state,
 * one consistent stat card. Every page answers "what is this?" and "what do I
 * do next?" in the first 100px.
 */

export function PageHeader({
  title,
  description,
  children,
}: {
  /** One short line that tells the user what this page is. */
  description?: string;
  /** Right-aligned page actions (buttons). */
  children?: React.ReactNode;
  title: string;
}) {
  return (
    <div className="mb-10 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div className="max-w-2xl">
        <h1 className="text-2xl font-medium tracking-tight sm:text-3xl">{title}</h1>
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
    <div className="flex flex-col items-center rounded-2xl border border-border px-8 py-14 text-center">
      {icon && (
        <span
          aria-hidden
          className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          {icon}
        </span>
      )}
      <p className="mt-4 font-medium">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{hint}</p>}
      {actionLabel &&
        (actionHref ? (
          <Link href={actionHref} className={cn(buttonVariants({ className: "mt-5" }))}>
            {actionLabel}
          </Link>
        ) : (
          <Button className="mt-5" onClick={onAction}>
            {actionLabel}
          </Button>
        ))}
    </div>
  );
}

/** The one stat card used across dashboard, purchases, earnings, and admin. */
export function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-card px-4 py-4 ring-1 ring-foreground/10">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-2xl font-medium tracking-tight">{value}</p>
      {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}
