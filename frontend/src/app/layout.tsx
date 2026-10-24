import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import { Toaster } from "sonner";
import SiteHeader from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  weight: "400",
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "AI Agent Space",
    template: "%s — AI Agent Space",
  },
  description:
    "Build, publish, and sell AI agents with real tool use, MCP servers, and multi-agent workflows.",
  icons: {
    icon: [
      { url: "/logos/icon.svg", type: "image/svg+xml" },
      { url: "/logos/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/logos/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/logos/icon-192x192.png", sizes: "192x192", type: "image/png" },
    ],
    shortcut: "/logos/icon.svg",
  },
  manifest: "/manifest.json",
};

/** Applies the persisted theme before first paint (no flash of wrong theme). */
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("theme");var d=t!=="light";document.documentElement.classList.toggle("dark",d);document.documentElement.classList.toggle("light",!d);}catch(e){document.documentElement.classList.add("dark");}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${plexMono.variable} dark h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <TooltipProvider delay={150}>
          <SiteHeader />
          <main className="flex flex-1 flex-col">{children}</main>
          <SiteFooter />
          <Toaster
            position="bottom-right"
            toastOptions={{
              classNames: {
                toast:
                  "rounded-lg bg-popover text-popover-foreground ring-1 ring-foreground/10 shadow-md font-sans",
                description: "text-muted-foreground",
              },
            }}
          />
        </TooltipProvider>
      </body>
    </html>
  );
}
