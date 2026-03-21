# cam2webrtc (ws2infer-js) - WebRTC Signaling Server

このプロジェクトは、WebRTC を用いたリアルタイム映像配信と、推論結果の共有・永続化を行うためのシグナリングサーバーです。
`ROLES.md` に定められた最強の「変更耐性」と「品質」を維持するための設計思想で構成されています。

<div align="center">
  <img src="./imgs/0.jpg" width="49%"></img>
  <img src="./imgs/1.jpg" width="49%"></img>
  <img src="./imgs/2.jpg" width="49%"></img>
</div>

## 🚀 実行方法

### サーバーの起動
```bash
cargo run
```
起動すると、`http://localhost:8080` (設定により https 可) で待ち受けを開始します。

### 配信・視聴
- 配信 (`Sender`): `http://localhost:8080/sender.html`
- 視聴 (`Viewer`): `http://localhost:8080/viewer.html`

## 🧪 テストの実行

### 自動テスト (Rust)
サーバーサイドのロジックを検証します。
```bash
cargo test
```

### ブラウザテスト (Client)
ブラウザ実機での WebRTC 機能やメッセージ形式を確認します。
1. サーバーを起動 (`cargo run`)
2. ブラウザで `http://localhost:8080/tests/browser_test.html` を開く

---
*この説明書は `ROLES.md` の思想を維持するために `README.md` として生成されました。*
