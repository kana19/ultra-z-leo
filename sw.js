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
 *  - バージョン反映は「選択式」：新バージョンは install 後に待機（waiting）し、
 *    自動では有効化しない。ページ側が更新バナーを出し、利用者が「更新」を選んだとき
 *    （SKIP_WAITING メッセージ受信時）だけ skipWaiting で切替える＝運用中PWAを無言で
 *    書き換えない。デプロイのたび CACHE_VERSION を上げると更新検知が発火する。
 *    ※ fetch は network-first のため本文（HTML/JS）はリロードで最新になる。運用店を
 *      更新まで完全に旧バージョンへ固定したい場合はシェルを cache-first へ切替える
 *      （将来対応・別途判断）。
 */
'use strict';

const CACHE_VERSION = 'uz-shell-v2';

self.addEventListener('install', (event) => {
  // 旧実装は self.skipWaiting() で即時・無言に自動更新していた。
  // 新実装は自動有効化せず waiting のまま待機し、利用者の選択（下の message）を待つ。
});

// ページからの更新指示（利用者が「更新」を選択）でのみ待機中の新SWを有効化する。
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
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
