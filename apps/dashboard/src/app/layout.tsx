import type { Metadata } from "next";
import { Noto_Serif_KR } from "next/font/google";
import "./globals.css";

const notoSerifKr = Noto_Serif_KR({
  subsets: ["latin"],
  weight: ["400", "600"],
  display: "swap",
  variable: "--font-hanja-family",
});

export const metadata: Metadata = {
  title: "gons.dashboard",
  description: "개인 사용자 대시보드",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={`h-full ${notoSerifKr.variable}`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
