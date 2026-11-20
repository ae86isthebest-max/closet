# 我的衣櫃

私人衣櫃網頁 App（加到 iPhone 主畫面用）。逐件衫影相 → 手機本機 AI 去背 → 自動計顏色、自己揀類別（免費）→ 入庫，可以左右碌配衫。Claude 自動認衫係選用功能，喺設定開，要 API key。

- 網址：https://ae86isthebest-max.github.io/closet/
- 相片、API key 全部只儲喺手機（IndexedDB）。只有縮細咗、去咗背景嘅衫相會送去 Claude 認衫。
- 改完程式：`npm install && npm run build`，然後 commit `dist/`、`index.html`、`sw.js`。

## 結構
- `src/segment.js`：去背（onnxruntime-web + ISNet），之後 P 圖功能可以重用
- `src/editor.js`：手動修邊筆刷
- `src/claude.js`：認衫
- `src/backup.js`、`src/zip.js`：備份／匯入
- `models/isnet-small.onnx`：去背模型

## 授權
去背模型取自 `@imgly/background-removal-data`（AGPL-3.0），所以成個 repo 都以 AGPL-3.0 公開。私人自用冇問題。
onnxruntime-web 同 Anthropic SDK 係 MIT。
