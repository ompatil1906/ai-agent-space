import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import SiteHeader from "@/components/site-header";
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
  title: "AI Agent Space",
  description:
    "Build, configure, run, and share advanced AI agents with real tool use, MCP servers, and multi-agent workflows.",
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${plexMono.variable} dark h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SiteHeader />
        <main className="flex-1 flex flex-col">{children}</main>
      </body>
    </html>
  );
}
