import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Job Finder",
  description: "Personal job aggregator, fit scorer, and application tracker",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <Link href="/" className="brand">
            Job Finder
          </Link>
          <Link href="/">Jobs</Link>
          <Link href="/pipeline">Pipeline</Link>
          <Link href="/settings">Settings</Link>
        </nav>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
