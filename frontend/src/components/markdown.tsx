import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "cn";

/**
 * Renders agent/LLM text output as GitHub-flavored Markdown, styled with the
 * app's design tokens (same muted surfaces in light & dark — see the
 * `[data-slot="markdown"]` rules in globals.css). Prose is de-max-width'ed and
 * margins tightened so it fits chat bubble / card layouts.
 *
 * Used for chat assistant messages, streaming replies, automation task outputs
 * and evaluation transcripts. User input and error text stay plain text.
 */
export function Markdown({ className, children }: { className?: string; children: string }) {
  return (
    <div
      data-slot="markdown"
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none",
        "prose-headings:my-2 prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-hr:my-2",
        "prose-code:rounded-sm prose-code:bg-muted/70 prose-code:px-1 prose-code:py-0.5 prose-code:font-medium prose-code:before:content-none prose-code:after:content-none",
        "prose-pre:my-2 prose-pre:rounded-md prose-pre:border prose-pre:border-border prose-pre:bg-muted/50 prose-pre:text-foreground prose-pre:text-[13px]",
        "prose-table:my-2 prose-blockquote:border-brand/40 prose-a:font-medium prose-a:text-brand",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
