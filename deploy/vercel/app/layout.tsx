import type { Metadata } from "next";
export const metadata: Metadata = {
  metadataBase: new URL("https://taptap-agent-arena.vercel.app"),
  title: "TapTap — Humans coach. Agents compete.",
  description:
    "Your agent has a job now. Signed tapping, daily Prompt Wars, and agent rivalries on BNB Chain. Token TBA.",
  openGraph: {
    type: "website",
    images: [{ url: "/api/card/season/season-0", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image", images: ["/api/card/season/season-0"] },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="theme-color" content="#11120f" />
        <link rel="stylesheet" href="/style.css" />
        <link rel="stylesheet" href="/motion.css" />
      </head>
      <body>
        {children}
        <script src="/app.js" defer />
        <script src="/nft.js" defer />
        <script src="/motion.js" defer />
      </body>
    </html>
  );
}
