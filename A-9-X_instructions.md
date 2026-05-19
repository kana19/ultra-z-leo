# A-9-X：業態固定概念撤廃 実装指示書

## このタスクの目的

ウルトラZAIMUくん（レオ）のコードベースから、業態固定の概念（業態テンプレート・uiLabels動的切替・入店/退店表記）を完全撤廃し、「出勤／退勤」表記に静的統一する。

源泉徴収はスタッフ個別の `withholdingMode` で判定し、UI用語切替も業態判定も不要になっているため、コアロジックから撤廃する。

## 思想的根拠（最重要・先に読むこと）

- 00_原則.md §2「禁止用語」：「店舗」「事業者」等の業態固定名称を排除
- 00_原則.md §4-1「納品時設定原則」：機能ON/OFFはターゲット社が納品時に設定。業態判定で自動切替する必要はない
- 07_将来構想.md §5：hostess-shop と general-shop の本質的差分は uiLabels と smartphoneVisible の2点のみ。両者とも本タスクで撤廃対象

## 絶対遵守事項

1. **attendance シートの物理列名「入店時刻」「退店日」「退店時刻」は維持**：既存ユーザー（kanamizuBAR等）のデータ破壊リスクを避けるため。GAS の `getAttendanceColMap_` も維持
2. **GAS アクション名 `clockIn` / `clockOut` は維持**：技術用語として扱う。コメントとログメッセージのみ「出勤打刻／退勤打刻」に変更
3. **settings B12 / B13 / B14 セルは物理的に削除しない**：既存ユーザーのスプレッドシートに値が残るが、コード側で参照しないため無害
4. **後方互換**：既存ユーザーの settings に templateId='hostess-shop' 等が残っていても、エラーにならず正常動作すること

## 修正対象ファイル一覧

```
ultra_zaimu_pwa/
├── history.html            ← data-uilabel-key 属性削除 2箇所
├── index.html              ← data-uilabel-key 属性削除 3箇所＋テキスト修正
├── js/
│   ├── app.js              ← 業態判定ロジック撤廃（約100行削除）
│   ├── settings.js         ← 業態表示・storeType関連撤廃（約30行削除）
│   ├── staff-clockin.js    ← UI_LABELS 撤廃・リテラル化
│   └── cost.js             ← コメント参照1箇所削除
└── gas/
    └── main.gs             ← getSettings/saveSettings/validateStaff から業態関連除去
```

---

## 修正① history.html

### 行538

**変更前**：
```html
<span data-uilabel-key="clockin_history">出勤履歴</span>
```

**変更後**：
```html
<span>出勤履歴</span>
```

### 行564

**変更前**：
```html
… <span data-uilabel-key="clockin_register">新規登録</span>
```

**変更後**：
```html
… <span>新規登録</span>
```

---

## 修正② index.html

### 行241

**変更前**：
```html
<span class="home-tab__label" data-uilabel-key="attendance_status">出勤状況</span>
```

**変更後**：
```html
<span class="home-tab__label">出勤状況</span>
```

### 行301

**変更前**：
```html
<span class="ipad-dash-header__title" data-uilabel-key="clockin_record">出勤状況</span>
```

**変更後**：
```html
<span class="ipad-dash-header__title">出勤状況</span>
```

### 行422

**変更前**：
```html
<a href="history.html#attendance" style="font-size:12px; color:var(--uz-muted); text-decoration:none;" data-uilabel-key="clockin_record">入店記録へ ›</a>
```

**変更後**：
```html
<a href="history.html#attendance" style="font-size:12px; color:var(--uz-muted); text-decoration:none;">出勤記録へ ›</a>
```

注：「入店記録へ」を「出勤記録へ」に変更。これが grep で唯一見つかった「入店」「退店」を含む直書きテキスト。

---

## 修正③ js/app.js

### 全体方針

業態判定ロジックを完全撤廃する。以下を削除：

- 定数：`UI_LABELS_KEY` / `UI_LABELS_HOSTESS` / `UI_LABELS_GENERAL` / `TEMPLATE_ID_KEY`
- 関数：`getTemplateId()` / `deriveUILabels()` / `deriveFeatureVisibility()` / `applyUILabels()` / `syncStoreTypeAtStartup()`
- localStorage キー保存：`uz_template_id` / `uz_store_type` / `uz_ui_labels`
- getSettings レスポンスから templateId / storeType / uiLabels の取り出し処理

### 削除対象の行（grep で確認済み）

```
行50-51   コメント: storeType ~ cost.js 参照用
行66-68   storeType 同期処理（getSettings レスポンスから）
行75-76   const valid = ['hostess-shop', 'general-shop', 'non-shop', 'custom'];
行82      localStorage.setItem('uz_ui_labels', JSON.stringify(d.uiLabels));
行107     applyUILabels() 呼び出し
行120-129 syncStoreTypeAtStartup 関数定義＋呼び出し
行125     templateId / uiLabels の即時反映コメント
行136-138 業態テンプレート関連コメント
行156     const UI_LABELS_KEY = 'uz_ui_labels';
行159-175 const UI_LABELS_HOSTESS = { ... };
行176-193 const UI_LABELS_GENERAL = { ... };
行194-198 getTemplateId() 関数定義
行305-331 deriveUILabels() 関数定義
行344-398 applyUILabels() 関数定義
行400-453 deriveFeatureVisibility() 関数定義＋getCurrentFeatureVisibility 関連
```

### 残置するロジック

- getSettings 呼び出しは維持（businessHours・storeName・staffList・serviceList の取得に必要）
- 取り出すレスポンスフィールドから templateId / storeType / uiLabels のみを除去

### featureVisibility の扱い

`deriveFeatureVisibility()` を削除する代わりに、固定値で返す関数に置換：

```javascript
function getCurrentFeatureVisibility() {
  return {
    payroll_section: true,
    shiftScheduleEnabled: false
  };
}
```

理由：featureVisibility は実装側で参照される箇所が残っているため、関数自体は残し、業態判定なしで固定値返却する。納品時設定原則に従い、ターゲット社が必要に応じて運営ポータル経由で settings B16 を直接書き換える運用に移行する（運営ポータル実装時に対応）。

---

## 修正④ js/settings.js

### 削除対象

```
行15      コメント: storeType 解説
行102-114 getStoreType / _saveStoreType 関数
行121     window.getStoreType = getStoreType;
行133     getSettings レスポンスから { storeType, templateId, businessHours } の取り出し
行137-141 storeType / templateId の localStorage キャッシュ処理
行240     templateEl.textContent = _templateIdLabel() 呼び出し
行272-279 _templateIdLabel() 関数定義
```

### 基本情報セクションへの影響

`settings.html` 側で「業態」表示行を持っている場合、その HTML 要素自体（id=template-label など）も合わせて削除する。具体的な行番号は settings.html を確認すること。

修正後の基本情報セクションは以下のみ表示：
- 店舗名
- プラン
- 提供元
- バージョン
- 営業時間（businessHours から派生表示）

---

## 修正⑤ js/staff-clockin.js

### 削除対象

```
行12   state.templateId プロパティ削除
行17-22 UI_LABELS 定数（hostess-shop / general-shop の両方）＋ getLabel() 関数削除
行66   state.templateId = v.templateId || 'general-shop'; 削除
```

### リテラル化

`getLabel(key)` 呼び出しを全てリテラルに置換。最終的に staff-clockin.js 内の表示文字列は以下に固定：

| 元の getLabel(key) | 置換後リテラル |
|---|---|
| `getLabel('in')` | `'出勤'` |
| `getLabel('out')` | `'退勤'` |
| `getLabel('today')` | `'今日の出勤状況'` |
| `getLabel('active')` | `'出勤中'` |
| `getLabel('inactive')` | `'未出勤'` |

具体的な該当箇所（renderPunchArea / renderTodayList / renderMonthly / executePunch のバナーメッセージ等）を全て置換する。

### validateStaff レスポンス処理

```javascript
state.staffName  = v.staffName;
state.storeName  = v.storeName;
state.templateId = v.templateId || 'general-shop';  ← この行を削除
```

---

## 修正⑥ js/cost.js

```
行507-508 syncStoreTypeAtStartup を参照しているコメント削除のみ
```

挙動への影響なし。コメントが不整合になるのを避けるための整理。

---

## 修正⑦ gas/main.gs

### getSettings 関数（行552-624 付近）

**変更前**（findstrで確認した内容より推測）：
- settings B12 storeType を読み取り → レスポンスに含める
- settings B13 templateId を読み取り → レスポンスに含める
- settings B14 uiLabels を読み取り → レスポンスに含める

**変更後**：
- B12 / B13 / B14 の読み取り処理を削除
- レスポンスに storeType / templateId / uiLabels を含めない
- B16 featureVisibility のみ読み取り維持（既存運用のため）
- B18 businessHours は維持

### saveSettings 関数（行626-665 付近）

**変更前**：
- payload.storeType を受け取って B12 に書き込む
- payload.templateId を受け取って B13 に書き込む
- payload.uiLabels を受け取って B14 に書き込む

**変更後**：
- storeType / templateId / uiLabels の受け取り処理を全て削除
- B12 / B13 / B14 への書き込みコードを削除

### validateStaff 関数（行2154-2163）

**変更前**：
```javascript
return {
  status: 'ok',
  data: {
    valid: true,
    staffId: staffId,
    staffName: String(found.name || ''),
    storeName: String(settings.data.storeName || ''),
    templateId: String(settings.data.templateId || 'general-shop')  ← この行削除
  }
};
```

**変更後**：
```javascript
return {
  status: 'ok',
  data: {
    valid: true,
    staffId: staffId,
    staffName: String(found.name || ''),
    storeName: String(settings.data.storeName || '')
  }
};
```

### initSettings 系（行1101-1190 付近）

```
- B12 storeType 初期化処理を削除
- B13 templateId 初期化処理を削除
```

新規ユーザーは B12 / B13 / B14 が空のままになるが、コード側で参照しないため無害。

### 維持する箇所（変更禁止）

- `getAttendanceColMap_`：headers.indexOf('入店時刻') 等を維持
- `clockIn` / `clockOut` アクション関数：そのまま維持
- attendance シート列名（appendRow の引数）：「日付」「スタッフID」「スタッフ名」「雇用形態」「入店時刻」「退店時刻」「登録日時」「案件ID」維持

### ログメッセージの整理（任意）

GAS の Logger.log メッセージ内に「入店打刻」「退店打刻」があれば「出勤打刻」「退勤打刻」に変更。コード挙動には影響しない。

---

## 動作確認チェックリスト（実装後）

ローカルで実装完了後、以下を git push 前に確認すること：

- [ ] HTMLのブラウザ表示で「入店」「退店」の文字が画面上に一切現れない
- [ ] スマホ版ホーム画面の「出勤状況」「出勤記録へ ›」が正しく表示
- [ ] 履歴画面の「出勤履歴」タブ表記が正しく表示
- [ ] 設定画面の基本情報セクションに「業態」行が消えている
- [ ] applyUILabels() が呼ばれているコードが残っていない（grep で再確認）
- [ ] data-uilabel-key 属性が HTML から消えている（grep で再確認）

---

## コミット手順

修正完了後、以下のコマンドで git push する：

```
cd "C:\Users\金光俊明\OneDrive - 株式会社ターゲット\ultrazaimu\ultra_zaimu_pwa"
git add history.html index.html settings.html js/app.js js/settings.js js/staff-clockin.js js/cost.js gas/main.gs
git commit -m "A-9-X: 業態固定概念撤廃（uiLabels撤廃・業態テンプレ撤廃・出勤退勤統一）"
git push
```

注：`git add -A` は禁止。ファイル名指定で add すること。

---

## GAS デプロイ

`gas/main.gs` を変更したため、ユーザーが手動で以下を実施する必要がある：

1. Apps Script エディタを開く（k@tgx.jp 所有のスプレッドシートから）
2. コード.gs（gas/main.gs と同期するファイル）に修正版を貼り付け
3. `Ctrl+S` で保存
4. 右上「デプロイ」→「デプロイを管理」→ アクティブなデプロイの鉛筆アイコン → バージョン「新しいバージョン」→ デプロイ
5. WebアプリURL不変確認

---

## 完了条件

1. 上記全ファイルの修正が完了
2. ローカルで動作確認（ブラウザ表示・コンソールエラーなし）
3. git push 完了
4. GitHub Pages 反映（1〜2分）
5. ブラウザでキャッシュクリア後の動作確認
6. GAS デプロイ完了
7. オーナーPWA・タイムカードPWA両方で「出勤／退勤」表記統一を確認

完了確認後、次のフェーズ（運営ポータル構築）に進む。

---

## 不明点・例外ケースの取扱

- 上記指示書で扱っていないコード箇所で「入店」「退店」「templateId」「uiLabels」「storeType」を発見した場合は、本指示書の趣旨（業態固定概念撤廃）に従って同様に処理すること
- 既存スプレッドシートのデータ（attendance シート・settings シート）は触らない
- 既存ユーザー（kanamizuBAR）の運用に影響しないこと
