# ウルトラ財務くん LEO版 PWA - Claude Code 引き継ぎファイル
# ultra_zaimu_pwa / CLAUDE.md
# 最終更新：2026-03-24

---

## 【プロジェクト概要】

**プロジェクト名：** ウルトラ財務くん LEO版 PWA  
**コンセプト：** スナック・BAR等のITリテラシーが低い個人事業主向けスマホ財務管理アプリ  
**目的：** デジタル化・AI導入補助金2026 インボイス枠のITツールとして登録・販売

---

## 【技術構成】

```
【フロントエンド】
PWA（HTML/CSS/JS）
→ スマホ特化UI・直感的な入力画面
→ manifest.jsonでホーム画面追加

        ↓ fetch（POST）

【バックエンド】
Google Apps Script（GAS）WebアプリURL
→ Googleスプレッドシートにデータ書き込み・読み込み

        ↓ 関数で自動計算

【データ】
Googleスプレッドシート（ultra_zaimu_LEO_GS_開発用）
→ 売上・コスト・勤怠データ蓄積
→ 損益計算書を自動集計
```

---

## 【GAS WebアプリURL（開発用）】

```
https://script.google.com/macros/s/AKfycbwy8WQIb-WYK-FDq2CKcjvJ8BSkEk8Ew0K-b0s05qoyi9Q7-quaatgI9L_vkU7W3Xd93g/exec
```

---

## 【GAS対応アクション一覧】

doPostに送るJSONの `action` フィールドで処理を切り替える。

| action | 説明 | 必須パラメータ |
|--------|------|--------------|
| `addSales` | 売上追加 | date, serviceCode, serviceName, taxIncluded, taxRate |
| `addCost` | コスト追加 | date, divisionCode, itemCode, itemName, taxIncluded, taxRate |
| `clockIn` | 入店記録 | staffId, staffName |
| `clockOut` | 退店記録 | staffId |
| `getPL` | 損益データ取得 | year, month |
| `getDateList` | 日付リスト取得 | なし |
| `checkLock` | ロック判定 | date |
| `getUncollected` | 未収・買掛け一覧 | なし |
| `reconcile` | 消込処理 | sheetName, rowIndex, paidAmount, paidDate |

### fetchの基本形

```javascript
const GAS_URL = 'https://script.google.com/macros/s/AKfycbwy8WQIb-WYK-FDq2CKcjvJ8BSkEk8Ew0K-b0s05qoyi9Q7-quaatgI9L_vkU7W3Xd93g/exec';

async function callGAS(action, data = {}) {
  const res = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, data })
  });
  return await res.json();
}
```

---

## 【税込入力の設計（確定）】

- ユーザーは税込金額のみ入力
- 税抜金額 = Math.floor(税込 / (1 + 税率/100))
- 消費税 = 税込 - 税抜
- 税率0%の場合：税込 = 税抜、消費税 = 0

---

## 【UIデザイン仕様（確定）】

### カラーパレット

```css
--uz-bg:      #1a1a2e;   /* 背景 */
--uz-surface: #222240;   /* カード・パネル */
--uz-surface2:#2a2a50;   /* ホバー・アクティブ */
--uz-red:     #e63946;   /* アクセント赤（コスト・アラート） */
--uz-blue:    #4361ee;   /* アクセント青（売上） */
--uz-text:    #f0f0f0;   /* テキスト */
--uz-muted:   #8888aa;   /* サブテキスト */
--uz-border:  rgba(255,255,255,0.07); /* ボーダー */
--uz-green:   #4ade80;   /* 在店中ドット */
--uz-silver:  #b0b0b0;   /* カラータイマー縁 */
```

### アラートドット仕様

| 種別 | 見た目 | 発動条件 |
|------|--------|---------|
| 未収あり（通常） | 青丸＋シルバー縁（常時点灯） | 未収データが存在する間 |
| 未収あり（緊急） | 赤丸点滅＋シルバー縁（縁は常時・赤fillのみ点滅） | 月末3日前 |
| 買掛あり（通常） | 青丸＋シルバー縁（常時点灯） | 未払データが存在する間 |
| 買掛あり（緊急） | 赤丸点滅＋シルバー縁（縁は常時・赤fillのみ点滅） | 月末3日前 |
| 退店未記録 | 赤丸点滅＋シルバー縁（縁は常時・赤fillのみ点滅） | 入店から24時間経過 |

```css
/* 青丸＋シルバー縁 */
.adot-blue {
  width: 13px; height: 13px; border-radius: 50%;
  background: #4361ee; border: 2px solid #b0b0b0;
}

/* 赤点滅：縁は常時・赤fillのみ点滅 */
.adot-red-blink {
  width: 13px; height: 13px; border-radius: 50%;
  border: 2px solid #b0b0b0;
  position: relative; overflow: hidden;
}
.adot-red-blink::after {
  content: ''; position: absolute; inset: 0; border-radius: 50%;
  background: #e63946;
  animation: fillblink 1s ease-in-out infinite;
}
@keyframes fillblink { 0%,100%{opacity:1} 50%{opacity:0} }
```

---

## 【画面構成（確定）】

| 画面 | ファイル | 状態 |
|------|---------|------|
| ホーム | index.html | デザイン確定済み |
| 売上入力 | sales.html | 実装待ち |
| コスト入力 | cost.html | 実装待ち |
| 入店記録 | clockin.html | デザイン確定済み |
| 未収・買掛け | uncollected.html | デザイン確定済み |
| 損益サマリー | pl.html | 実装待ち |
| 設定 | settings.html | 実装待ち |

---

## 【ホーム画面の構成（確定）】

```
ヘッダー
  └── 店舗名 ／ 日付（曜日）・時刻（リアルタイム）

入力セクション
  └── 売上入力ボタン（青＋アイコン）＋未収アラートドット
  └── コスト入力ボタン（赤＋アイコン）＋買掛アラートドット

入店記録行
  └── 入店記録ボタン＋退店未記録アラートドット

勤怠リスト（直近入店順3名）
  └── 氏名 ／ 入店時刻 ／ 退店ボタン or 未入店
  └── 「さらに表示」（白文字）

今月の損益
  └── 損益サマリー（売上・仕入原価・粗利・販管費・経常利益）

ボトムナビ
  └── ホーム ／ 損益 ／ 入力履歴 ／ 設定
```

---

## 【売上入力画面の仕様（確定）】

- 発生日：今日の日付を自動セット（変更可）
- サービス選択：マスタ登録のサービスをラジオボタン（最大3種＋諸口）※事業単位（店内売上・テイクアウト・ケータリング等）
- 諸口選択時：品目名入力フィールドを表示
- 金額入力：税込金額を入力 → 税抜・消費税を自動表示（青系）
- 税率：0%/8%/10%のトグル（デフォルトはサービスマスタの税率）
- ロイヤル管理：売上の内訳として登録顧客をプルダウン（直近入力順）＋金額入力
- 未収トグル：OFFがデフォルト
- アクセントカラー：ブルー統一
- 登録ボタン：画面下部固定

---

## 【コスト入力画面の仕様（確定）】

- 発生日：今日の日付を自動セット（変更可）
- 区分選択：仕入原価 / 販管費（2択ラジオ）
- 科目選択：区分に応じた科目一覧を展開
- 諸口選択時：科目名入力フィールドを表示
- 金額入力：税込金額を入力 → 税抜・消費税を自動表示（赤系）
- 税率：0%/8%/10%のトグル
- 未払トグル：OFFがデフォルト
- アクセントカラー：レッド統一
- 登録ボタン：画面下部固定

---

## 【スプレッドシート列構成】

### 売上シート（salesテーブル）
```
A:日付 B:年 C:月 D:顧客コード E:売上対象 F:サービスコード
G:サービス H:諸口品目名 I:金額（税抜） J:税率 K:消費税
L:税込金額 M:メモ N:入金日 O:入金額 P:未収フラグ
Q:消込状況 R:登録日時 S:ロックフラグ
```

### コストシート（costテーブル）
```
A:日付 B:年 C:月 D:区分コード(1=原価/2=販管費) E:経費区分
F:科目コード G:科目 H:諸口科目名 I:金額（税抜） J:税率
K:消費税 L:税込金額 M:メモ N:支払日 O:支払額
P:未払フラグ Q:消込状況 R:登録日時 S:ロックフラグ
```

---

## 【ロック・猶予期間ルール】

- 当月：自由に修正可
- 翌月1〜5日：猶予期間（前月分も修正可）
- 翌月6日以降：完全ロック（サポートで解除・有償）

---

## 【AIフック（削除禁止・フェーズ3用）】

```html
<div id="receipt-capture-area" style="display:none"></div>
<div id="csv-import-area" style="display:none"></div>
<div id="ai-suggestion-area" style="display:none"></div>
```

---

## 【絶対ルール（変更不可）】

- AI提案を自動確定する機能は実装禁止
- 編集・削除・登録はすべてユーザーが明示的にボタンをタップして確定
- マクロ・VBA不使用（GAS/PWAのみ）
- 本番スプレッドシート（ultra_zaimu_LEO_本番参照用.xlsx）は編集禁止

---

## 【稼働中スタッフ機能・仕様変更予定（フェーズ3以降）】

- 「入店記録」→「コストを入れる（人件費・委託外注費）」に画面名変更
- TOP表示「本日のスタッフ」→「稼働中」に変更
- アカウント付与したレギュラースタッフのみ表示
- スタッフマスタは settings.html と Googleスプレッドシートのマスタシートで管理
- 退店時刻入力（通常）：24時間以内の場合はプルダウンで前後30分・5分刻みで選択
- 退店時刻入力（長時間）：24時間超の場合は赤点滅表示・日付＋時間を手入力

---

## 【次のタスク】

1. index.html（ホーム画面）の実装
2. sales.html（売上入力）の実装
3. cost.html（コスト入力）の実装
4. GAS接続テスト（addSales・addCost）
5. manifest.json・アイコン設定
6. スマホ実機テスト
