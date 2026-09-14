"use client";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type Asset = { path: string; url: string; bytes: number };
const AssetUrls = createContext<Record<string, string>>({});
export function useAssetUrl(path: string) {
  return useContext(AssetUrls)[path] ?? path;
}

// Retain decoded images for this page's lifetime; re-renders share in-flight work.
const images = new Map<string, HTMLImageElement>();
const loading = new Map<string, Promise<void>>();
function loadImage(url: string): Promise<void> {
  if (images.has(url)) return Promise.resolve();
  const pending = loading.get(url);
  if (pending) return pending;
  const promise = new Promise<void>((resolve, reject) => {
    const img = new Image();
    const controller = new AbortController();
    let objectUrl: string | undefined;
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      if (ok) {
        images.set(url, img);
        resolve();
      } else {
        controller.abort();
        img.src = "";
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        reject(new Error("image_unavailable"));
      }
    };
    const timer = setTimeout(() => finish(false), 120000);
    img.onload = () => {
      if (typeof img.decode === "function")
        img.decode().then(
          () => finish(true),
          () => finish(false),
        );
      else finish(true);
    };
    img.onerror = () => finish(false);
    // Render the exact bytes we downloaded, independent of HTTP cache eviction
    // or proxy cache policy. Object URLs remain alive for this page's lifetime.
    void fetch(url, { signal: controller.signal, cache: "force-cache" })
      .then(async (response) => {
        if (!response.ok) throw new Error("image_unavailable");
        const blob = await response.blob();
        if (settled) return;
        objectUrl = URL.createObjectURL(blob);
        img.src = objectUrl;
      })
      .catch(() => finish(false));
  }).finally(() => loading.delete(url));
  loading.set(url, promise);
  return promise;
}

export function GameAssets({
  assets,
  children,
}: {
  assets: Asset[];
  children: ReactNode;
}) {
  const [attempt, setAttempt] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [failed, setFailed] = useState(0);
  const [finished, setFinished] = useState(false);
  const [continueAnyway, setContinueAnyway] = useState(false);
  const urls = useMemo(
    () =>
      Object.fromEntries(
        assets.map((a) => [a.path, images.get(a.url)?.src ?? a.url]),
      ),
    [assets, completed],
  );
  useEffect(() => {
    let cancelled = false;
    let cursor = 0;
    let done = 0;
    let errors = 0;
    setFinished(false);
    setFailed(0);
    setCompleted(0);
    const worker = async () => {
      while (!cancelled && cursor < assets.length) {
        const asset = assets[cursor++];
        try {
          await loadImage(asset.url);
          done++;
        } catch {
          errors++;
        }
        if (!cancelled) {
          setCompleted(done);
          setFailed(errors);
        }
      }
    };
    void Promise.all(Array.from({ length: 3 }, worker)).then(() => {
      if (!cancelled) setFinished(true);
    });
    return () => {
      cancelled = true;
    };
  }, [assets, attempt]);
  const ready = continueAnyway || (finished && failed === 0);
  const percent = assets.length
    ? Math.floor((completed / assets.length) * 100)
    : 100;
  return (
    <AssetUrls.Provider value={urls}>
      {ready ? (
        children
      ) : (
        <main className="asset-loading" aria-labelledby="asset-loading-title">
          <section className="asset-loading-card">
            <span className="asset-loading-kicker">
              蜗牛与盐选城 · 跑团剧场
            </span>
            <div className="loading-dice" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
            <h1 id="asset-loading-title">
              {finished ? "还有几张画没送到" : "故事正在布置中"}
            </h1>
            <p>
              {finished
                ? "网络似乎慢了一点，重试就能接着加载。"
                : "先准备好场景和角色，等你入座。"}
            </p>
            <div
              className="asset-loading-progress"
              role="progressbar"
              aria-label="图片加载进度"
              aria-valuemin={0}
              aria-valuemax={assets.length}
              aria-valuenow={completed}
              aria-valuetext={`${completed} / ${assets.length} 张图片`}
            >
              <span style={{ width: `${percent}%` }} />
            </div>
            <div className="asset-loading-count">
              <span>
                {completed} / {assets.length}
              </span>
              <strong>{percent}%</strong>
            </div>
            <p className="asset-loading-note" role="status">
              {finished
                ? `${failed} 张图片暂时没有加载成功。`
                : "初次进入需要一点时间，加载过的图片会尽量复用。"}
            </p>
            {finished && failed > 0 ? (
              <div className="asset-loading-actions">
                <button
                  className="primary"
                  onClick={() => setAttempt((a) => a + 1)}
                >
                  重试加载
                </button>
                <button onClick={() => setContinueAnyway(true)}>
                  先进入游戏
                </button>
              </div>
            ) : null}
          </section>
        </main>
      )}
    </AssetUrls.Provider>
  );
}
