# CLAUDE.md — 佐藤心ダイマ作成AIシステム 開発引き継ぎ資料

## 1. システム概要

アイドルマスター シンデレラガールズの佐藤心（しゅがーはぁと）への総選挙投票を呼びかける
「ダイマ（直接マーケティング）画像」をAIで自動生成・編集・保存するWebアプリ。

- **ホスティング**: HuggingFace Spaces（Docker SDK）
- **バックエンド**: Node.js + Express（`server.js`）
- **フロントエンド**: React 18（CDN版）+ Babel Standalone（`public/index.html`）
- **AI**: Anthropic Claude API（`claude-sonnet-4-6`）

-----

## 2. ファイル構成

```
/
├── Dockerfile          # chromiumなし・expressのみ・シンプル構成
├── package.json        # 依存: express のみ
├── server.js           # Expressサーバー + Claude APIプロキシ
├── public/
│   └── index.html      # アプリ本体（React + Babel、約1200行）
└── CLAUDE.md           # 本ファイル
```

### server.js の役割

- `GET /`           → `public/index.html` を静的配信
- `POST /api/claude` → Anthropic API へのプロキシ（APIキーはHuggingFace Secretsで管理）

### public/index.html の構造

- Babel Standalone で JSX をブラウザコンパイル（`type="text/babel" data-presets="react"`）
- すべてのロジック・UIが1ファイルに集約
- 外部スクリプト: React 18 CDN、html2canvas 1.4.1

-----

## 3. アプリの画面フロー

```
[PINロック画面] → [フォーム画面] → [編集画面] → [完成画面]
     ↑                                 ↑
  PIN: 0722               AIに修正依頼（チャット形式）
```

### 3-1. PINロック画面

- PINコード `0722` で認証

### 3-2. フォーム画面（構造化入力）

- **必須**: ページ数（1〜4枚）
- **推奨**: デザインテーマ（王道スウィーティー / ポップキュート / 大人スウィーティー / おまかせ）
- **推奨**: レイアウト方向性（イラスト重視 / メッセージ重視 / バランス型）
- **任意**: メインカラー / サブカラー（カラーピッカー or おまかせ）
- **任意**: 掲載テキスト・セリフ
- **任意**: その他こだわり要望

### 3-3. 編集画面

- **モバイル**: タブ切り替え（✍️ 編集 / 📱 プレビュー）、ヘッダー・フッターは `position:fixed`
- **デスクトップ**: 左サイドバー（コントロール）+ 右プレビュー（iframe）

#### コントロールパネル（左側）

1. テキスト編集セクション（後述）
1. 画像ライブラリ（モバマス39枚・デレステ38枚 from GitHub Pages CDN + 直接アップロード）
1. 位置・回転・拡大縮小・文字サイズスライダー（各プレースホルダー要素ごと）
1. AIへの修正依頼テキストエリア

#### プレビュー（右側 / モバイルはタブ）

- `<iframe>` で生成HTMLをリアルタイム表示（`srcDoc`）
- 9:16アスペクト比、幅360px基準
- テキスト要素にドラッグ移動・↻回転ハンドル注入（INTERACTION_JS）
- テキスト要素に「✎ テキストNを編集」ボタン表示（モバイル対応）

### 3-4. 完成画面

- html2canvas でプレビューiframeをキャプチャ（scale:2 = 高品質）
- PNG画像を表示 → 長押し（スマホ）/ 右クリック（PC）で保存
- CORS制限で失敗した場合はスクリーンショット案内

-----

## 4. AI生成の仕組み

### システムプロンプト（`SYSTEM_PROMPT_TEMPLATE`）

```
- 生成幅: max-width:360px, aspect-ratio:9/16
- 最外郭コンテナに overflow:hidden 必須（はみ出し防止）
- 画像: <img src="{{IMAGE_n}}"> + <!-- ここで画像を書き換える -->
- テキスト: {{TEXT_n}} プレースホルダー使用（AIが従わない場合あり）
- 必須末尾: 「#しゅがーはぁとを心デレラに」ハッシュタグ
```

### フォーム値をプロンプトに埋め込み

```js
SYSTEM_PROMPT_TEMPLATE
  .replace('{{PAGE_COUNT}}', pageCount)
  .replace('{{THEME}}', designTheme)
  .replace('{{LAYOUT_DIR}}', layoutDir)
  .replace('{{MAIN_COLOR}}', colorSpec)
  .replace('{{TEXT_CONTENT}}', textContent)
  .replace('{{ADDITIONAL_REQUEST}}', addReq)
```

### 生成後の処理（`handleGenerate` / `handleRevise`）

1. Claude APIからHTML文字列を受信
1. `processHtmlFromAI(html)` → **現状はHTML無改変でそのまま返す**（後述の問題参照）
1. `rawHtml` に格納
1. `baseHtml`（useMemo）で `{{IMAGE_n}}` を `<img data-daima="image-n">` に置換
1. `{{TEXT_n}}` を `<span data-daima="text-n">` に置換（AIがプレースホルダーを使った場合のみ）
1. 400ms debounce後 `srcDoc` → iframe更新

### チャット履歴

- 修正依頼はチャット形式で蓄積（`chatHist`）
- 修正時は同じシステムプロンプト + チャット履歴 + 新しい依頼をAPIに送信

-----

## 5. iframeインタラクション（INTERACTION_JS / INTERACTION_CSS）

iframeロード後に `setupIframe()` が注入するスクリプト・スタイル。

### `INTERACTION_JS` が行うこと

- `[data-daima="image-n"]` / `[data-daima="text-n"]` 要素をドラッグ・回転可能にする
- ↻ ハンドル（`span.dm-rh`）を追加
- `window.daimaSet(transforms)` 関数を定義（親からtransform適用用）
- テキスト要素のシングルタップ検出 → `postMessage({type:'dm-tap', id, text})` 送信
- ドラッグ後 → `postMessage({type:'dm-t', id, t:{x,y,r,s,fs}})` 送信

### `window.daimaSet(ts)` の動作

```js
ST[id] = Object.assign({x:0,y:0,r:0,s:1,fs:100}, ST[id], t);
el.style.transform = `translate(${x}px,${y}px) rotate(${r}deg) scale(${s})`;
el.style.fontSize = fs !== 100 ? `${fs}%` : '';
```

### `applyTrans(nt)` の動作（親側）

- `iw.daimaSet(nt)` を呼び出す
- `daimaSet` 未定義時のフォールバック: 直接 `el.style.transform` を操作

### `setupIframe()` の自動テキスト抽出

iframeロードから150ms後に実行:

1. `rawHtml` に `{{TEXT_n}}` プレースホルダーがなければ自動抽出モードへ
1. `doc.body.querySelectorAll('*')` で全要素を走査
1. `getComputedStyle` で非表示要素をスキップ
1. 直接テキストノードを持つ要素に `data-daima="text-n"` を付与
1. 同一テキストは同じIDを再利用（増殖防止）
1. 既存ユーザー編集（`autoTextsRef.current`）を再適用
1. `setAutoTexts({...})` で親Reactのstateを更新

-----

## 6. State 一覧

|state         |型          |説明                                    |
|--------------|-----------|--------------------------------------|
|`auth`        |bool       |PIN認証済みか                              |
|`screen`      |string     |‘prompt’ / ‘edit’ / ‘complete’        |
|`rawHtml`     |string     |AIから受け取ったHTML（無改変）                    |
|`textVals`    |object     |`{id: text}` プレースホルダー方式のテキスト値         |
|`imgUrls`     |object     |`{id: url}` 画像URL                     |
|`autoTexts`   |object     |`{num: text}` 自動抽出テキスト値（直接DOM操作用）     |
|`trans`       |object     |`{elemId: {x,y,r,s,fs}}` 各要素のtransform|
|`hiddenElems` |array      |非表示にした要素IDリスト                         |
|`editModal`   |object/null|テキスト編集モーダルの状態                         |
|`chatHist`    |array      |AIとのチャット履歴                            |
|`completedUrl`|string/null|キャプチャしたPNG data URL                   |
|`saving`      |bool       |保存処理中か                                |
|`loading`     |bool       |AI生成中か                                |

-----

## 7. 現在の既知バグ・未解決課題

### 🔴 優先度：高

#### 7-1. 編集画面でコンポーネントが表示されない【最新の未修正バグ】

**症状**: 編集画面の「位置・回転・拡大縮小」セクション（TransformPanel）が表示されない

**原因**:

- `allElemIds` は `textIds`（rawHtmlの`{{TEXT_n}}`）と `imgIds`（rawHtmlの`{{IMAGE_n}}`）から計算される
- `processHtmlFromAI` をHTMLを改変しない実装に変更したため、`rawHtml` にはプレースホルダーが含まれない
- よってAIが `{{TEXT_n}}` / `{{IMAGE_n}}` を使わない場合、`textIds` = `[]`、`imgIds` = `[]` となり `allElemIds` = `[]`
- TransformPanel が一切描画されない

**修正方針**:

```js
// allElemIds を autoTexts も含めて計算する
const allElemIds = useMemo(() => [
  ...textIds.map(id => `text-${id}`),
  // autoTextsから自動抽出されたIDを追加（textIdsがない場合）
  ...(textIds.length === 0 ? Object.keys(autoTexts).map(n => `text-${n}`) : []),
  ...imgIds.map(id => `image-${id}`)
], [textIds, imgIds, autoTexts]);
```

- TransformPanel 内の「✎ 文字を編集」ボタンも `autoTexts[num]` を参照するよう修正
- `confirmEditModal` も `autoTexts` を更新＋iframe DOM直接操作に対応

#### 7-2. 画像の `data-daima` 属性がiframeに付与されない

**症状**: 画像の位置・回転スライダーが機能しない（TransformPanelが表示されても）

**原因**:

- `setupIframe` のテキスト自動抽出は実装済みだが、`img` タグへの `data-daima` 付与は未実装
- `{{IMAGE_n}}` プレースホルダーが `rawHtml` にない場合、imgIdsも空

**修正方針**:

- `setupIframe` で `doc.body.querySelectorAll('img')` も走査し、`data-daima="image-n"` を付与
- `autoImgs` state（autoTextsと同様）を追加して管理

#### 7-3. テキスト編集モーダルの確定処理が autoTexts に未対応

**症状**: 「🅰 サイズも変える」モーダルで確定しても、autoTextsの場合に反映されない

**原因**: `confirmEditModal` が `setTextVals` しか更新していない（プレースホルダー方式のみ対応）

**修正方針**:

```js
const confirmEditModal = useCallback(() => {
  if (!editModal) return;
  const num = editModal.num;
  const isAuto = !textIds.includes(num); // autoTexts かどうか

  if (isAuto) {
    setAutoTexts(p => ({...p, [num]: editModal.text}));
    // iframe DOM を直接更新
    const el = iframeRef.current?.contentDocument?.querySelector(`[data-daima="text-${num}"]`);
    if (el) Array.from(el.childNodes).forEach(nd => {
      if (nd.nodeType === 3 && nd.textContent.trim()) nd.textContent = editModal.text;
    });
  } else {
    setTextVals(p => ({...p, [num]: editModal.text}));
  }
  // フォントサイズは共通
  const nt = {...transRef.current, [editModal.id]: {...(transRef.current[editModal.id]||{x:0,y:0,r:0,s:1}), fs: editModal.fs}};
  setTrans(nt); applyTrans(nt); setEditModal(null);
}, [editModal, applyTrans]); // textIds は useRef にすべきかも
```

### 🟡 優先度：中

#### 7-4. テキスト・位置の変更が保存時に反映されないことがある

**症状**: プレビューで移動させた要素が、保存後のPNGで元の位置にある

**原因**: html2canvas はプレビューiframeをキャプチャするが、transform変換や一部CSSが正しくキャプチャされないことがある

**修正方針**: `handleSave` でキャプチャ前に `iframe.contentWindow.scrollTo(0,0)` + 十分な待機時間

#### 7-5. AIが {{TEXT_n}} / {{IMAGE_n}} プレースホルダーを使わないことがある

**症状**: テキスト・画像の編集パネルが表示されない（自動抽出で補完しているが不完全）

**現状**: `setupIframe` での自動テキスト抽出で対応中。画像は未対応。

**修正方針**:

- システムプロンプトを強化（プレースホルダー使用をより厳密に指示）
- `setupIframe` で画像の自動タグ付けも実装（7-2と同）

#### 7-6. iframeからの postMessage でテキスト編集モーダルが開かない（スマホ）

**症状**: スマホでテキスト要素をタップしてもモーダルが開かない

**現状**: コントロールパネルの「✍️ テキストを編集する」テキストエリアで直接入力は可能。
プレビュータブに「✎ テキストNを編集」ボタンを表示する代替UIを実装済み（`textIds.length > 0` の場合のみ）。

**修正方針**: プレビューパネルの編集ボタンを `autoTexts` のIDにも対応させる

### 🟢 優先度：低

#### 7-7. 出力画像のフォントが変わることがある

html2canvas がWebフォント（Google Fonts等）をキャプチャできないことがある。
`document.fonts.ready` で待機しているが不完全。

#### 7-8. 切り取り線（複数ページ）が出力に含まれる

複数ページ生成時の「✂—CUT—✂」行が最終出力に含まれる。
現状は仕様として許容。

-----

## 8. 実装済みの主要機能

- ✅ PIN認証（0722）
- ✅ 構造化フォーム（ページ数・テーマ・レイアウト・カラー・テキスト・要望）
- ✅ Claude APIによるHTML自動生成（max_tokens: 8000）
- ✅ AIへの修正依頼（チャット形式）
- ✅ 画像ライブラリ（モバマス39枚・デレステ38枚）+ 直接アップロード
- ✅ iframeプレビュー（リアルタイム更新、400msデバウンス）
- ✅ ドラッグ移動・回転（INTERACTION_JS）
- ✅ 位置・回転・拡大縮小・文字サイズスライダー
- ✅ 要素の非表示/表示トグル
- ✅ テキスト直接編集（テキストエリア / モーダル）
- ✅ テキスト自動抽出（iframeDOM from setupIframe）
- ✅ 保存 → 完成画面（PNG表示・長押しで保存案内）
- ✅ モバイル対応（fixed header/footer・タブ切り替え）
- ✅ スマホ自動ズーム防止（maximum-scale=1.0）

-----

## 9. 技術的な注意点・制約

### HuggingFace Spaces固有

- `ANTHROPIC_API_KEY` は HuggingFace の Secrets に設定（環境変数）
- Dockerfileに chromium は不要（html2canvasはブラウザ側で実行）
- `CMD ["node", "server.js"]` で起動、ポート7860

### Babel Standalone の制約

- テンプレートリテラル（バッククォート）がシステムプロンプト等の文字列に混入すると**コンパイルエラーで真っ白画面**になる
- `SYSTEM_PROMPT_TEMPLATE` 内の ````` はプレーンテキストに書き換えること
- `INTERACTION_JS` はJS文字列として定義（Babelの対象外）、バックティックは `'text-'+n` 形式の文字列結合で記述

### iframe sandboxとpostMessage

- `sandbox="allow-same-origin allow-scripts"` で `window.parent.postMessage` は動作する
- ただし iOS Safari では touchend の判定が不安定（タップでdm-tapが発火しないことがある）
- **代替UI**: コントロールパネルのテキストエリアが最も確実な編集手段

### html2canvas の制約

- `allowTaint: false` + `useCORS: true` を使用
- GitHub Pages からの画像（外部CORS）は `useCORS:true` で基本的に取得可能
- フォントはキャプチャ前に `fonts.ready` + 400ms待機で対応

### DOMParserとouterHTMLの危険性

- AI生成HTMLをDOMParserで解析→outerHTMLで再シリアライズすると、CSSアニメーション・JavaScriptの動作が壊れる
- テキストが増殖したり消えたりする原因になる
- **rawHtml は絶対に改変しない**。テキスト抽出・編集はすべてiframe DOM上で行うこと

-----

## 10. 画像ライブラリURL構成

```
ベースURL:
- モバマス: https://nagomi-sugarheart.github.io/SugarHeartDB/Mobamas/{CardFolder}/
- デレステ: https://nagomi-sugarheart.github.io/SugarHeartDB/Deresute/{CardFolder}/

ファイル種別:
- フル画像: {CardName}.jpg
- 背景透過: {CardName}Touka.png
- ぷちでれら: {CardName}PuchiDerela.png （デレステのみ）
```

-----

## 11. ClaudeCode への引き継ぎタスク

以下を優先度順に実装・修正してください。

### 最優先タスク

1. **バグ修正 7-1**: `allElemIds` を `autoTexts` 対応にする
1. **バグ修正 7-2**: `setupIframe` で img 要素にも `data-daima` を自動付与
1. **バグ修正 7-3**: `confirmEditModal` を autoTexts に対応させる

### 追加実装タスク

1. プレビューパネルの「✎ テキストNを編集」ボタンを autoTexts にも対応させる
1. 修正後に Babel コンパイルチェックを実施（`@babel/standalone` で確認）

### コンパイルチェックコマンド

```bash
node -e "
const babel = require('@babel/standalone');
const fs = require('fs');
const content = fs.readFileSync('public/index.html', 'utf8');
const match = content.match(/<script type=\"text\/babel\"[^>]*>([\s\S]*?)<\/script>/);
try {
  babel.transform(match[1], {presets: ['react']});
  console.log('OK');
} catch(e) {
  console.log('ERROR:', e.message.split('\n').slice(0,4).join('\n'));
}
"
```