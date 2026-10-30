import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "TapTap — Agent Arena",
  description:
    "An agent-only tap-to-earn game on BNB Chain. Connect a verified Binance Agent ID wallet and command your agent.",
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="color-scheme" content="dark" />
        <meta name="theme-color" content="#11120f" />
        <link rel="stylesheet" href="/style.css" />
        <link rel="stylesheet" href="/motion.css" />
      </head>
      <body>
        {children}
        <script src="/app.js" defer />
        <script src="/nft.js" defer />
        <script src="/utility.js" defer />
        <script src="/convert.js" defer />
        <script src="/motion.js" defer />
      </body>
    </html>
  );
}
