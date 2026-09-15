"use client";
import { PageRecovery } from "@/components/game/PageRecovery";
export default function ErrorPage({
  error,
}: {
  error: Error & { digest?: string };
}) {
  return <PageRecovery error={error} />;
}
