"use client";
import { useEffect, useRef, useState } from "react";

/** Indeterminate progress: elapsed time is real, no invented completion percentage. */
export function ModelLoading({
  title,
  detail,
  slowMessage,
  reveal = false,
}: {
  title: string;
  detail: string;
  slowMessage?: string;
  reveal?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reveal) ref.current?.scrollIntoView({ block: "nearest" });
  }, [reveal]);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, []);
  return (
    <div ref={ref} className="model-loading" role="status" aria-label={title}>
      <div className="flipping-book" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="model-loading-copy">
        <strong>{title}</strong>
        <p>{seconds >= 20 && slowMessage ? slowMessage : detail}</p>
        <small aria-live="off">已等待 {seconds} 秒</small>
      </div>
    </div>
  );
}
