import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mnemosyne — The Private Knowledge Archive",
  description: "A quiet, beautifully organized home for your notes, ideas and lasting knowledge.",
  applicationName: "Mnemosyne",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en">
    <head>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;500;600;700&family=Noto+Nastaliq+Urdu:wght@400;500;600;700&family=Noto+Sans+Arabic:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />
    </head>
    <body>{children}</body>
  </html>;
}
