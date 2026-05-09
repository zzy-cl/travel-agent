// src/app/layout.tsx
// 根布局 — 所有页面共享的外层结构
//
// 这是 Next.js App Router 的约定文件:
// - 定义 <html> 和 <body> 标签
// - 加载全局样式（globals.css）和字体
// - 设置 metadata（SEO 标题/描述）
//
// ── KaTeX CSS ──
// 加载 katex/dist/katex.min.css 用于数学公式渲染（在 MessageBubble 的 Markdown 中使用）。

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "katex/dist/katex.min.css";

const inter = Inter({
  variable: "--font",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "智能旅游规划助手",
  description: "告诉我你的旅行想法，我来帮你规划",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={`${inter.variable} antialiased`}>
      <body className="min-h-full bg-[#e8ecf4]">{children}</body>
    </html>
  );
}
