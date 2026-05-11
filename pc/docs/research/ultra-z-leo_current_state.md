# ウルトラZAIMUくん LEO版 PWA ─ 現状棚卸しレポート

- 作成日：2026-04-23
- 起点コミット：`7b3688d`（S3g-4 / S3g-4b 完了時点）
- ブランチ：main
- 作成目的：S3g-4c 凍結に伴い、現状の実装範囲・未実装範囲を網羅的に整理する

---

## 1. HTML ファイル一覧

### スマホ / iPad 共用（プロジェクトルート直下）

| ファイル | 役割 |
|---|---|
| `index.html` | ホーム画面。スマホ版ボトムナビ・iPad 版サイドバー両対応。ダッシュボード・「売上／コストを入れる」ボタン経由で SheetModal を起動 |
| `sales.html` | 売上入力フルページ版（スマホではほぼ未使用・iPad のサイドパネル経路で利用） |
| `cost.html` | コスト入力フルページ版（同上） |
| `clockin.html` | 入店／退店記録画面 |
| `history.html` | 履歴・修正画面（売上コスト／入店履歴の2タブ） |
| `pl.html` | 損益サマリー画面（月次／年次タブ） |
| `uncollected.html` | 未収・買掛け一覧画面（消込 UI 含む） |
| `settings.html` | 設定画面（店舗名・スタッフマスタ・サービスマスタ・コスト科目マスタ） |

### PC 版（`pc/` 配下・別実装）

| ファイル | 役割 |
|---|---|
| `pc/index.html` | PC 版ホーム |
| `pc/sales.html` | PC 版売上入力 |
| `pc/clockin.html` | PC 版入店記録 |
| `pc/history.html` | PC 版履歴 |
| `pc/settings.html` | PC 版設定 |

※ `pc/cost.html` / `pc/pl.html` / `pc/uncollected.html` は**存在しない**（PC 版は未整備）。

---

## 2. JS ファイル一覧と各ファイルの役割

| ファイル | 行数 | 役割 |
|---|---|---|
| `js/app.js` | ~400 | 共通ロジック。`callGAS()` による GAS 通信、税計算 `calcTax()`、日付ユーティリティ、`DEFAULT_COST_MASTER` / `getCostMaster()` / `saveCostMasterToStorage()`、iPad／PC 判定（body クラス付与）、勤務時間計算 `calcWorkDuration()` |
| `js/sheet-modal.js` | ~300 | 汎用シートモーダル基盤（§12.5-1 準拠）。`SheetModal.open/close/showValidationError/confirmOptional` を `window` に露出。ドラッグ閉じ・history.pushState 連携あり |
| `js/sales.js` | 927 | 売上入力（フルページ版＋ SheetModal 版 `_sm*`）。`STAFF_MASTER_KEY` / `getStaffMaster()` 定義（※ clockin.js と重複）、サービスマスタ `getServiceMaster()`、税率チップ UI、内消費税リアル表示、個別行（indiv-row）アコーディオンで顧客＋サービス選択、`addSales` 送信 |
| `js/cost.js` | 933 | コスト入力（フルページ版 L1〜L457 ＋ SheetModal 版 L459〜L933 `_smCost*`）。区分タブ（仕入原価／販管費）＋科目カード＋税率チップ。`addCost` 送信（withholdingAmount は未対応） |
| `js/clockin.js` | ~900 | **入店記録画面ロジック**。詳細は §2-1 |
| `js/home.js` | ~650 | ホーム画面ロジック。リアルタイム時計、ヘッダー日付、アラートドット（未収・買掛・未記録退店）、今月損益カード、iPad ダッシュボード（KPI カード・月次棒グラフ・損益5行テーブル・年度累計・税理士用 CSV DL） |
| `js/pl.js` | ~500 | 損益サマリー。月次／年次タブ、期間ナビ、比較モード、展開 state、`getSummary` のクライアント側キャッシュ |
| `js/history.js` | ~800 | 履歴・修正。2 タブ（売上コスト／入店履歴）、月選択、編集フォーム、新規入店登録フォーム（時刻セレクト 0〜29h / 5分刻み） |
| `js/uncollected.js` | ~300 | 未収・買掛け一覧。`getUncollected` / `reconcile` 連携、消込フォームの展開／送信 |
| `js/settings.js` | ~500 | 設定画面。localStorage ＋ GAS 双方向同期、スタッフ／サービス／コスト科目マスタの CRUD、接続状態表示 |

### 2-1. `js/clockin.js` の機能概要

- **目的**：スタッフの入店／退店記録。「記録忘れ修正」と「未登録スタッフの手動記録」を 1 画面で完結
- **状態管理**：今日分の勤怠は `ATTENDANCE_DATA_KEY`（localStorage）に JSON 配列で保存。日付をまたぐと自動リセット
- **UI 構成**：
  - スタッフマスタ由来のクイックボタン（`getStaffMaster()` から描画）
  - マスタ外スタッフ向けテキスト入力（`name-input`）
  - 日付＋入店時刻＋退店時刻（5 分刻みセレクト）の入力フォーム
  - 当日の勤怠一覧（在店中／退店済みをソート分離・カード表示）
  - カード内で「退店時刻のみ後から追加」インライン退店入力
- **GAS 送信**：
  - `clockIn`（新規登録）
  - `clockOut`（rowIndex ＋ clockOutTime で部分更新）
  - `updateAttendance`（フル修正）
- **起動時**：`getSettings` でスタッフマスタをバックグラウンド同期
- **iPad 専用パネル**：`initIpadCiPanel` / `_ipadCiGetTimeVal` など別系統の iPad サイドパネル描画あり

---

## 3. `index.html` の主要 DOM 構造

### 全体レイアウト

```
<body data-page="home">
 ├─ <nav class="nav-sidebar">  ← iPad のみ表示（スマホでは CSS で hidden）
 │    ├─ ロゴ
 │    ├─ ホーム／売上コスト／入店記録／履歴／設定のリンク
 │    └─ <div class="sidebar-recent" id="sidebar-recent">  ← 最近の入力（iPad のみ）
 │
 ├─ <div class="page-wrapper">
 │    ├─ <header class="app-header">
 │    │    ├─ 店舗名（"スナック LEO"）
 │    │    ├─ #header-date
 │    │    └─ #header-time  ← 1秒毎更新
 │    │
 │    └─ <main class="page-body">
 │         ├─ <div class="ipad-home-dashboard" hidden>  ← iPad 専用ダッシュボード
 │         │    ├─ 左 2/3：KPI カード（売上・経常利益）／月次棒グラフ／損益5行テーブル
 │         │    └─ 右 1/3：年度累計カード／確定申告タイマー／税理士用 CSV DL
 │         │
 │         ├─ <div class="ipad-col--left">（スマホでは通常表示）
 │         │    ├─ [💰 売上を入れる] ボタン（onclick="openSalesModal()"）
 │         │    │    └─ #dot-uncollected  ← 未収ありドット
 │         │    ├─ [💸 コストを入れる] ボタン（onclick="openCostModal()"）
 │         │    │    └─ #dot-payable  ← 買掛ありドット
 │         │    └─ 今月の損益カード（売上／仕入原価／粗利／販管費／経常利益）
 │         │
 │         └─ <div class="ipad-col--right">
 │              ├─ #tax-timer  ← 確定申告期間中のみ表示
 │              └─ [📋 未収・買掛けを確認する] ボタン → uncollected.html
 │
 ├─ <nav class="bottom-nav">  ← スマホ用ボトムナビ
 │    └─ ホーム／損益／履歴／設定
 │
 ├─ #loading-overlay
 └─ AIフック用非表示コンテナ（receipt-capture-area / csv-import-area / ai-suggestion-area）
```

### スクリプトロード順

```html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
<script src="js/app.js"></script>
<script src="js/sheet-modal.js"></script>
<script src="js/sales.js"></script>
<script src="js/cost.js"></script>
<script src="js/home.js"></script>
```

→ `cost.js` からは `app.js` の `getCostMaster()` ／ `sales.js` の `getStaffMaster()` を関数直接参照できる。

### 入店中スタッフ表示部分

**`index.html` のホーム画面には、入店中スタッフ一覧を表示する UI は存在しない。**

関連要素：
- サイドバーの `<div class="sidebar-recent" id="sidebar-recent">` は「最近の入力」用（iPad のみ）で、入店中スタッフ専用ではない
- `home.js` 内には `todayAttendance` state と `callGAS('getAttendance', { date })` の取得ロジックが存在（L136〜）、`home.js:110-111` に「入店 HH:MM — 在店中」形式のテンプレートもある
- ただし描画先の DOM がホーム画面に配置されていない（`home.js` 側のロジックが **どこに描画するつもり**か要確認）
- 退店処理 `callGAS('clockOut', ...)` は `home.js:266` に存在する

→ 実装途中で、入店中スタッフ表示の DOM 接続が抜けている可能性が高い。

---

## 4. スタッフマスタの列構造

### オブジェクト定義（settings.js:18-23）

```javascript
const DEFAULT_STAFF = [
  { id: 1, name: 'さくら', employmentType: 'employed' },
  { id: 2, name: 'あかね', employmentType: 'employed' },
  { id: 3, name: 'みか',   employmentType: 'employed' },
  { id: 4, name: 'ゆき',   employmentType: 'employed' },
];
```

### 全フィールド一覧

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | integer | スタッフ ID（`maxId + 1` で自動採番、settings.js:319） |
| `name` | string | スタッフ名 |
| `employmentType` | string | 雇用形態。現状 `'employed'` のみ利用（settings.js:232, 319） |

### 読み出し関数の重複状況

| 関数／定数 | 定義場所 | 実装 |
|---|---|---|
| `STAFF_MASTER_KEY = 'uz_staff_master'` | sales.js:10, clockin.js:12, settings.js:13 | 3 ファイルで重複（文字列同一） |
| `getStaffMaster()` | sales.js:28, clockin.js:17 | 2 ファイルで重複（エラー時 `[]`） |
| `getStaffList()` | settings.js:39 | 設定専用（エラー時 `[...DEFAULT_STAFF]`） |

### 永続化

- localStorage キー：`uz_staff_master`
- GAS 同期：`getSettings`（起動時に `staffList` を受領して localStorage 上書き）／ `saveSettings` / `saveStaffList`（localStorage 保存後にバックグラウンド送信）

### ⚠ 源泉徴収関連フィールドの不在

- **`withholdingType`（`'hostess'` / `'standard'` / `'employed'`）フィールドは現時点で存在しない**
- attendance_v3.gs 側では列 D が「雇用形態」となっており、GAS は `employmentType` を受け入れるが、`withholdingType` の受け渡しはなし
- §13-6（源泉徴収条件表示）を動かすには、このフィールドの追加が前提

---

## 5. スプレッドシート側のシート一覧

ローカルの GAS ソース（`gas/*.gs`）と `js/*.js` の `callGAS` 呼び出しから判る範囲。本体 GAS（Apps Script プロジェクト内の `doGet` / `doPost`）はローカルにないため、以下は**間接的な推定**。

### 確定しているシート

| シート名 | 用途 | 根拠 |
|---|---|---|
| `attendance` | 入店記録（v3：8列 A=入店日／B=スタッフ ID／C=スタッフ名／D=雇用形態／E=入店時刻／F=退店日／G=退店時刻／H=登録日時） | `gas/attendance_v3.gs` に列構成が明示 |
| `settings` | 各種マスタ（B4 セルに `costMasterList` JSON を保存。storeName / staffList / serviceList も同シート内の想定） | `gas/costmaster_additions.gs:47-59` |
| `sales` | 売上記録（列 A=発生日、serviceCode 列あり） | `gas/sales_ranking.gs:19-35` |
| `cost` | コスト記録（推定・cost.js が `addCost` を呼び、payload に itemCode/itemName/taxRow/taxRate/taxIncluded/memo/divisionCode を含む） | `js/cost.js:850-861`（_smCostHandleSubmit）／旧 cost.js L232 |

### GAS アクション一覧（js 側から逆引き）

| アクション | 呼び出し元 | 用途 |
|---|---|---|
| `getSettings` | clockin.js, settings.js | storeName / staffList / serviceList を取得 |
| `saveSettings` | settings.js | 上記3点をまとめて保存 |
| `saveStaffList` | settings.js | スタッフマスタのみ保存 |
| `getCostMaster` | cost.js, settings.js | コスト科目マスタ取得 |
| `saveCostMaster` | settings.js | コスト科目マスタ保存 |
| `addSales` | sales.js | 売上登録 |
| `addCost` | cost.js | コスト登録 |
| `getSummary` | pl.js, home.js, app.js | 月次損益取得（キャッシュあり） |
| `getHistory` | history.js, home.js | 売上／コスト履歴取得 |
| `getAttendance` | home.js | 当日の入店記録取得 |
| `getAttendanceByMonth` | history.js | 月次入店履歴取得 |
| `clockIn` | clockin.js, home.js | 入店登録 |
| `clockOut` | clockin.js, home.js | 退店時刻追記（rowIndex 更新） |
| `updateAttendance` | clockin.js, history.js | 入店記録の修正 |
| `getUncollected` | uncollected.js, home.js | 未収・買掛け一覧取得 |
| `reconcile` | uncollected.js | 消込処理 |
| `getSalesCategoryRanking` | ※ GAS 側関数は存在するが、js 側での呼び出しは未確認 | サービスコード頻度ランキング |

### 未確認の可能性あり

- 売上シート（sales）の全列構成（serviceCode 以外）
- コストシート（cost）の列構成
- 年度横断集計用シート（税理士用 CSV の元シート等）

---

## 6. 実装済みの主要機能

### ホーム / 共通基盤
- PWA マニフェスト（`manifest.json`）・iOS ステータスバー対応
- デバイス判定（iPad / PC / スマホ）による body クラス自動付与
- リアルタイム時計・ヘッダー日付
- 未収・買掛け・未記録退店アラートドット
- 確定申告タイマー表示枠（期間中のみ）
- 汎用 SheetModal 基盤（`js/sheet-modal.js`・ドラッグ閉じ・history.pushState）

### 売上入力
- フルページ版（`sales.html`）
- SheetModal 版 §12.5-1 準拠（`index.html` 経由で呼び出し）
- 税率チップ（10% / 8% / 非課税）＋内消費税リアルタイム表示（S3g-3f）
- サービスマスタ連携・諸口対応
- 個別行（顧客＋サービス選択・手入力／諸口）アコーディオン
- 未収フラグ送信

### コスト入力
- フルページ版（`cost.html`・S2 系・既存）
- SheetModal 版（`index.html` 経由・S3g-4 / S3g-4b 完了）
- 区分タブ（仕入原価／販管費）
- 科目カード（COST_MASTER 連携）＋諸口対応
- 税率チップ＋内消費税リアル表示

### 入店記録
- 入店／退店（日跨ぎ対応・v3 8列構造）
- 記録忘れの事後編集
- マスタ外スタッフの手動記録
- attendance v3 マイグレーション GAS（`setupAttendanceMigrationV3`）

### 履歴・修正
- 売上／コスト履歴（月選択・修正フォーム）
- 入店履歴（月選択・修正フォーム・新規入店登録フォーム）

### 損益サマリー
- 月次タブ（期間ナビ・比較モード・展開 state）
- 年次タブ
- `getSummary` のクライアント側キャッシュ

### 未収・買掛け
- 一覧表示＋消込フォーム（インライン展開）

### 設定
- 店舗名／スタッフマスタ／サービスマスタ／コスト科目マスタ CRUD
- GAS との双方向同期
- 接続状態表示

### iPad 専用
- ホームダッシュボード（KPI カード・月次棒グラフ・損益5行テーブル・年度累計）
- 税理士用 CSV DL パネル
- 売上コスト入力・入店記録のサイドパネル

### GAS（リポジトリに含まれる分）
- attendance_v3 全アクション＋マイグレーション
- costmaster 取得／保存
- サービスコード頻度ランキング

---

## 7. 未実装の主要機能（§10.5-7 / §13-6 等と比較）

### §13-6（源泉徴収条件表示）関連

| 項目 | 状態 |
|---|---|
| スマホ版 SheetModal コスト入力の源泉徴収条件表示（S3g-5） | **未実装**（S3g-5 指示書は作成済みだが、前提不足で凍結） |
| 取引先（スタッフ）セレクト UI in コスト SheetModal（S3g-4c） | **未実装**（指示書作成済み・本会話で凍結） |
| 給与所得の源泉徴収税額表 | 永久非搭載（スコープ外として確定） |
| iPad / PC 版 源泉徴収記録（S2e） | 未実装 |
| settings の `FEATURE_WITHHOLDING_ENABLED` トグル（S3g-6） | 未実装 |
| GAS v6（`withholdingAmount` 列対応）デプロイ（S3g-7） | 未実装 |

### スタッフマスタ拡張（§13-6 前提）

| 項目 | 状態 |
|---|---|
| `withholdingType` フィールド（`'hostess'` / `'standard'` / `'employed'`） | **未実装**。現状 `employmentType: 'employed'` のみ |
| 設定画面での `withholdingType` 編集 UI | 未実装 |
| GAS 側での `withholdingType` 永続化（settings シート staffList JSON の拡張） | 未実装 |

### ホーム画面の入店中スタッフ表示（§10.5-7 想定）

| 項目 | 状態 |
|---|---|
| 当日入店中スタッフの一覧表示 | **DOM なし／ロジックは home.js に部分的に存在**。描画先の配置が抜けている |
| ワンタップ退店ボタン | home.js:266 にロジックはあるが、ホームの DOM に接続されていない |
| 在店中／退店済みの分離表示 | `home.js:110-111` にテンプレートあり・接続先なし |

### PC 版未整備

| 項目 | 状態 |
|---|---|
| `pc/cost.html` | 未作成 |
| `pc/pl.html` | 未作成 |
| `pc/uncollected.html` | 未作成 |

### GAS `withholdingAmount` 対応

- 現 GAS は `addCost` の payload に `withholdingAmount` を含めても保存されない可能性が高い
- S3g-7 で GAS v6 をデプロイする必要あり

### その他の既知 TODO（コメント・コード痕跡から）

- `js/cost.js:540`「源泉徴収額欄：S3g-5（§13-6）で実装予定・本版では非表示」
- `js/cost.js:849`「withholdingAmount / miscItemName / unpaid は S3g-5 以降で追加予定・本版では送信しない」
- AI フック（receipt-capture-area / csv-import-area / ai-suggestion-area）：フェーズ3 用・現状は非表示コンテナのみ

---

## 付録：Phase A 優先度1 ラインの DRY 未整理事項

S3g-4c 指示書でも言及されていたが、以下のコード重複が存在：

- `STAFF_MASTER_KEY = 'uz_staff_master'`：sales.js / clockin.js / settings.js の 3 ファイルで重複定義
- `getStaffMaster()`：sales.js / clockin.js で重複定義（エラー時戻り値が同一）
- `getStaffList()`（settings.js）：エラー時に `[...DEFAULT_STAFF]` を返す差異

→ Phase A 優先度1 ラインの終盤でヘルパー集約予定（S3g-4c 指示書の記述）。
