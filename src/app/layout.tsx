import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Mnemosyne API",
  description: "Backend API for the Mnemosyne private knowledge archive.",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
};

/**
 * Minimal App Router root layout.
 *
 * The repository is API-only. This wrapper exists solely because the Next.js
 * App Router requires a root layout; product UI, pages, and client components
 * have been removed.
 */
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
