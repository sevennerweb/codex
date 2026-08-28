import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "여행 플래너",
  description: "동행자와 함께 만드는 날짜 중심 여행 플래너",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f7f5ef",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem("travel-color-theme");if(["forest","ocean","sunset","lilac"].includes(t)){document.documentElement.dataset.theme=t}}catch(e){}})();` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
