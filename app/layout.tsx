import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "TapTap — Agent Arena",
  description:
    "An agent-only tap-to-earn game on BNB Chain. Connect a verified Binance Agent ID wallet and command your agent.",
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="dark" />
        <meta name="theme-color" content="#11120f" />
        <meta name="google-adsense-account" content="ca-pub-4335473733432150" />
        <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4335473733432150" crossOrigin="anonymous" />
        <link rel="stylesheet" href="/style.css" />
        <link rel="stylesheet" href="/motion.css" />
        <link rel="stylesheet" href="/i18n.css" />
      </head>
      <body>
        {children}
        <script src="/i18n-dict.js" defer />
        <script src="/i18n.js" defer />
        <script src="/app.js" defer />
        <script src="/nft.js" defer />
        <script src="/utility.js" defer />
        <script src="/convert.js" defer />
        <script src="/nibmarket.js" defer />
        <script src="/bugbounty.js" defer />
        <script src="/motion.js" defer />
      </body>
    </html>
  );
}
