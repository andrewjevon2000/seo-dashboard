import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Verihubs SEO Dashboard",
  description: "Article-level SEO & content performance over time (Verihubs).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <header className="border-b border-edge bg-panel">
          <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold tracking-tight text-ink">
                Verihubs SEO
              </span>
              <span className="rounded bg-edge px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                GSC · v1
              </span>
            </div>
            <nav className="text-xs text-muted">
              <a href="/articles" className="hover:text-ink">
                Articles
              </a>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
