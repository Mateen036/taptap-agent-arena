import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Nib Foundry · BNB Testnet Review",
  description:
    "Testnet-only NFT review. Disposable agents and test assets; no Binance mainnet transactions.",
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="theme-color" content="#10110f" />
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body>
        {children}
        <script src="/testnet-review.js" defer />
      </body>
    </html>
  );
}
