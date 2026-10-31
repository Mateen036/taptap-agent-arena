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
const V=(process.env.VERCEL_GIT_COMMIT_SHA||process.env.VERCEL_DEPLOYMENT_ID||"dev").slice(0,12);
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="dark" />
        <meta name="theme-color" content="#11120f" />
        <meta name="google-adsense-account" content="ca-pub-4335473733432150" />
        <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4335473733432150" crossOrigin="anonymous" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
        <link rel="stylesheet" href={"/style.css?v="+V} />
        <link rel="stylesheet" href={"/motion.css?v="+V} />
        <link rel="stylesheet" href={"/i18n.css?v="+V} />
      </head>
      <body>
        {children}
        <script src={"/i18n-dict.js?v="+V} defer />
        <script src={"/i18n.js?v="+V} defer />
        <script src={"/app.js?v="+V} defer />
        <script src={"/nft.js?v="+V} defer />
        <script src={"/utility.js?v="+V} defer />
        <script src={"/convert.js?v="+V} defer />
        <script src={"/nibmarket.js?v="+V} defer />
        <script src={"/bugbounty.js?v="+V} defer />
        <script src={"/motion.js?v="+V} defer />
      </body>
    </html>
  );
}
