import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Sans, Martian_Mono } from "next/font/google";
import "./globals.css";

/* Martian Mono is the machine voice — counts, rates, timestamps.
   Instrument Sans is the human one — everything written for a reader. */
const mono = Martian_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

const sans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Miner",
  description: "Live progress for a generator ingestion run.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${mono.variable} ${sans.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
