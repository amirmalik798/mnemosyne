import type { Metadata } from "next";
import { headers } from "next/headers";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mnemosyne — The Private Knowledge Archive",
  description: "A quiet, beautifully organized home for your notes, ideas and lasting knowledge.",
  applicationName: "Mnemosyne",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script
          nonce={nonce}
          id="mnemosyne-theme-init"
          dangerouslySetInnerHTML={{
            __html: "(function(){try{var t=localStorage.getItem('mnemosyne-theme');document.documentElement.dataset.theme=t==='light'?'light':'dark';var f=localStorage.getItem('mnemosyne-font');var valid=['source-sans','inter','atkinson','lato','plus-jakarta'];document.documentElement.dataset.font=valid.indexOf(f)!==-1?f:'source-sans';}catch(_){document.documentElement.dataset.theme='dark';document.documentElement.dataset.font='source-sans';}})();",
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Atkinson+Hyperlegible:wght@400;700&family=Cinzel:wght@500;600;700;800&family=EB+Garamond:ital,wght@0,400..700;1,400..700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Lato:wght@400;700;900&family=Noto+Naskh+Arabic:wght@400;500;600;700&family=Noto+Nastaliq+Urdu:wght@400;500;600;700&family=Noto+Sans+Arabic:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=Source+Sans+3:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
