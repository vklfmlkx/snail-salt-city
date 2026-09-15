"use client";
import type { CSSProperties } from "react";

function diagnostic(error: Error & { digest?: string }) {
  const message = `${error.name} ${error.message}`;
  const category = /QuotaExceeded|SecurityError|storage/i.test(message)
    ? "STORAGE"
    : /structuredClone|randomUUID|is not a function|not defined/i.test(message)
      ? "COMPAT"
      : /ChunkLoad|Loading chunk|dynamically imported|CSS_CHUNK/i.test(message)
        ? "FILES"
        : error.digest
          ? "SERVER"
          : "PAGE";
  let hash = 2166136261;
  for (const char of message)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `${category}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
const button: CSSProperties = {
  display: "inline-block",
  padding: "12px 20px",
  background: "#ffd978",
  color: "#172a3a",
  border: "2px solid #172a3a",
  textDecoration: "none",
  fontWeight: 700,
};

/** Independent of artwork, browser storage and the failed game component. */
export function PageRecovery({
  error,
}: {
  error: Error & { digest?: string };
}) {
  return (
    <main
      style={{
        minHeight: "100svh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        boxSizing: "border-box",
        background: "#fff8e7",
        color: "#172a3a",
        fontFamily: 'system-ui, "Microsoft YaHei", sans-serif',
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 540,
          padding: 28,
          boxSizing: "border-box",
          border: "2px solid #172a3a",
          background: "#fffdf6",
          boxShadow: "8px 8px 0 #efd18c",
        }}
      >
        <p style={{ fontSize: 14 }}>蜗牛与盐选城</p>
        <h1 style={{ fontSize: 26 }}>这一页暂时出了点状况</h1>
        <p style={{ lineHeight: 1.8 }}>
          已保存的游戏进度仍在。重新打开后，可以从封面继续。
        </p>
        <a style={button} href="/?recover=1">
          重新打开游戏
        </a>
        <p style={{ fontSize: 14, lineHeight: 1.8, marginTop: 24 }}>
          如果再次出现，请尝试更新浏览器，或用系统浏览器打开，并把下面的错误编号反馈给我们。
        </p>
        <p style={{ fontSize: 12, overflowWrap: "anywhere" }}>
          错误编号：{diagnostic(error)}
        </p>
      </section>
    </main>
  );
}
