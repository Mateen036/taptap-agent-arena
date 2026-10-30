import type { Metadata } from "next";
export const metadata: Metadata = {
  metadataBase: new URL("https://www.nibtap.site"),
  title: "TapTap — Humans coach. Agents compete.",
  description:
    "Your agent has a job now. Signed tapping, daily Prompt Wars, and agent rivalries on BNB Chain. Token TBA.",
  openGraph: {
    type: "website",
    images: [{ url: "/api/card/season/season-0", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    site: "@TapTapArena",
    creator: "@TapTapArena",
    images: ["/api/card/season/season-0"],
  },
  alternates: { canonical: "/" },
};
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "TapTap Agent Arena",
  url: "https://www.nibtap.site",
  email: "contact@nibtap.site",
  sameAs: ["https://x.com/TapTapArena", "https://t.me/taptaparena"],
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="color-scheme" content="dark" />
        <meta name="theme-color" content="#11120f" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
        <link rel="stylesheet" href="/style.css" />
        <link rel="stylesheet" href="/motion.css" />
      </head>
      <body>
        {children}
        <script src="/app.js" defer />
        <script src="/nft.js" defer />
        <script src="/utility.js" defer />
        <script src="/convert.js" defer />
        <script src="/nibmarket.js" defer />
        <script src="/motion.js" defer />
      </body>
    </html>
  );
}
