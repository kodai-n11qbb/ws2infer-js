# cam2webrtc (ws2infer-js) - WebRTC Signaling Server

このプロジェクトは、WebRTC を用いたリアルタイム映像配信と、推論結果の共有・永続化を行うためのシグナリングサーバーです。
`DEV_POLICY.md` に定められた最強の「変更耐性」と「品質」を維持するための設計思想で構成されています。

<div align="center">
  <img src="./imgs/0.jpg" width="49%"></img>
  <img src="./imgs/1.jpg" width="49%"></img>
  <img src="./imgs/2.jpg" width="49%"></img>
</div>

## 🚀 実行方法

### サーバーと WASM の起動 (自動ビルド)
```bash
cargo run
```
プロジェクトには **Cargo Workspace** と **Build Script (`build.rs`)** が統合されています。
`cargo run` を実行するだけで、以下の処理が自動で行われます：
1. **WASM ビルド**: `wasm_inference` クレートが `wasm-pack` によりビルドされ、`static/pkg/` に展開されます。
2. **サーバー起動**: `cam2webrtc` シグナリングサーバーが起動し、`http://localhost:8080` (設定により https 可) で待ち受けを開始します。

### 配信・視聴
- 配信 (`Sender`): `http://localhost:8080/sender.html`
- 視聴 (`Viewer`): `http://localhost:8080/viewer.html`
- **推論モード**: Tesseract (標準/高精度/数字特化) に加え、**Rust-WASM 高速化モデル**が利用可能です。

## 🧪 テストの実行

### 自動テスト (Server & WASM)
サーバーサイドのロジックと WASM 推論ヘルパーの両方を一括で検証します。
```bash
cargo test
```
*Workspace 構成により、全クレートのテストが同時に実行されます。*

### ブラウザテスト (Client)
ブラウザ実機での WebRTC 機能やメッセージ形式を確認します。
1. サーバーを起動 (`cargo run`)
2. ブラウザで `http://localhost:8080/tests/browser_test.html` を開く

---
*この説明書は `DEV_POLICY.md` の思想を維持するために `README.md` として生成されました。*
