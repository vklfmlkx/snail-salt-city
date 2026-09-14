import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "蜗牛与盐选城 · 跑团剧场",
  description:
    "猫咪城主主持的文字冒险。选择精选故事或组合喜欢的标签，与伙伴交谈，作出关键选择，走向不同结局。",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
