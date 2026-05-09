import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="ko" className="h-full">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
