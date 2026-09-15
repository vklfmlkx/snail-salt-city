"use client";
import { PageRecovery } from "@/components/game/PageRecovery";
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0 }}>
        <PageRecovery error={error} />
      </body>
    </html>
  );
}
