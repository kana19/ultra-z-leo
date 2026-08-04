/**
 * ウルトラZAIMUくん PWA — Service Worker
 *
 * 目的：PWAインストール要件（fetchハンドラ）の充足＋アプリシェルのオフライン起動。
 * 設計方針（開発中フェーズ前提）：
 *  - 同一オリジンGETのみ傍受し network-first（オンライン時は常に最新コードが勝つ＝
 *    開発中の「古いUIがキャッシュに固着」を防ぐ）。取得成功したものだけ実行時キャッシュへ。
 *  - オフライン時のみキャッシュへフォールバック（訪問済みページが開ける）。
 *  - 外部オリジン（GAS = script.google.com / fonts / jsdelivr CDN）は一切傍受しない
 *    ＝財務データ・API応答をキャッシュしない（常にネットワーク）。
 *  - 非GET（POST等のGAS書込）は傍受しない。
 *  - CACHE_VERSION を上げるたび旧キャッシュを activate で一掃。
 */
'use strict';

const CACHE_VERSION = 'uz-shell-v1';

self.addEventListener('install', (event) => {
  // 新バージョンを即時有効化（開発中は更新の反映を待たせない）
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // GET かつ 同一オリジンのみ対象。それ以外（GAS API・外部CDN・POST）は素通り。
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      try {
        // network-first：オンライン時は最新を取得し、成功レスポンスのみキャッシュ更新。
        const fresh = await fetch(req);
        if (fresh && fresh.ok && fresh.type === 'basic') {
          const cache = await caches.open(CACHE_VERSION);
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch (err) {
        // オフライン等：キャッシュにあれば返す。ナビゲーションは index.html へフォールバック。
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === 'navigate') {
          const shell = await caches.match('./index.html');
          if (shell) return shell;
        }
        throw err;
      }
    })()
  );
});
