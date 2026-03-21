# cam2webrtc (ws2infer-js)

WebRTC を用いたリアルタイム映像配信と、クライアントサイド推論（物体検出・日本語OCR）を行うシグナリングサーバーです。  
`DEV_POLICY.md` に定められた「変更耐性」と「品質」を維持する設計思想で構成されています。

<div align="center">
  <img src="./imgs/0.jpg" width="49%"></img>
  <img src="./imgs/1.jpg" width="49%"></img>
  <img src="./imgs/2.jpg" width="49%"></img>
</div>

## 📐 アーキテクチャ

```
Sender (カメラ)  ──WebRTC──▶  Viewer (推論 + 表示)
         ▲                         │
         └── Signaling (WS) ◀──────┘
                  │
          Rust (Warp + STUN/TURN)
```

| レイヤー | 技術 |
|---------|------|
| サーバー | Rust (Warp / Tokio) — WebSocket, HTTPS (自己署名証 自動生成), STUN, TURN |
| フロント | Vanilla JS — COCO-SSD (TF.js) / **ndlocr-lite-wasm** (日本語OCR) |
| OCR エンジン | [ndlocr-lite-wasm](https://github.com/tamoco-mocomoco/ndlocr-lite-wasm) — DEIM (テキスト検出) + PARSeq (テキスト認識), ONNX Runtime WASM |
| 映像 | WebRTC 1:N P2P Mesh |

## 🚀 実行方法

### 前提条件
- Rust (stable)
- Node.js / npm (ndlocr-lite-wasm ビルド用)

### サーバー起動 (自動ビルド)
```bash
cargo run
```
`build.rs` により初回実行時に以下が自動で行われます：
1. **ndlocr-lite-wasm ビルド** — `ndlocr-lite-wasm-src/` をクローン＆ビルドし `static/ndlocr/` へ展開
2. **opencv.js ダウンロード** — `static/js/opencv.js` が無い場合に自動取得
3. **サーバー起動** — `https://localhost:8080` で待ち受け開始 (HTTPS + 自己署名証明書)

### 配信・視聴
| ページ | URL |
|--------|-----|
| 配信 (Sender) | `https://localhost:8080/sender.html` |
| 視聴 (Viewer) | `https://localhost:8080/viewer.html` |

他端末からアクセスする場合は `localhost` をサーバーの LAN IP に読み替えてください。

### 推論モデル切り替え
Viewer 側で以下のモードを選択できます：

| モデル | 説明 |
|--------|------|
| `coco_ssd` | 物体検出 (TensorFlow.js, GPU) — デフォルト |
| `ocr_gpu` | **日本語テキスト認識** (ndlocr-lite-wasm) — DEIM 検出 + PARSeq 認識 |

## 🧪 テスト

### 自動テスト
```bash
cargo test
```

| テスト種別 | 件数 | 内容 |
|-----------|------|------|
| ユニットテスト | 11 | signaling, room, config, STUN, TURN |
| 統合テスト | 1 | シグナリングフロー全体 |

### ブラウザテスト
1. `cargo run` でサーバーを起動
2. `https://localhost:8080/tests/browser_test.html` を開く

## 📁 ディレクトリ構成

```
ws2infer-js/
├── src/                    # Rust サーバー
│   ├── main.rs             # エントリポイント
│   ├── lib.rs              # Warp ルーティング, TLS, COOP/COEP ヘッダー
│   ├── room.rs             # ルーム管理 (1:N P2P Mesh)
│   ├── signaling.rs        # WebSocket シグナリング
│   ├── persistence.rs      # 推論結果永続化 (SQLite)
│   ├── stun.rs             # STUN サーバー
│   ├── turn.rs             # TURN サーバー
│   ├── config.rs           # config.json パーサー
│   └── network.rs          # LAN IP 取得
├── static/                 # フロントエンド
│   ├── js/
│   │   ├── viewer.js       # Viewer ロジック + 推論エンジン群
│   │   ├── base.js         # WebRTC 共通基盤
│   │   ├── sender.js       # Sender ロジック
│   │   └── opencv.js       # OpenCV.js (自動DL, .gitignore対象)
│   ├── ndlocr/             # ndlocr-lite-wasm ビルド成果物 (自動生成, .gitignore対象)
│   │   └── assets/
│   │       ├── ocr.worker.js                           # OCR Web Worker
│   │       └── ort-wasm-simd-threaded.jsep-*.wasm      # ONNX Runtime WASM
│   ├── viewer.html
│   └── sender.html
├── ndlocr-lite-wasm-src/   # ndlocr-lite-wasm ソース (.gitignore対象)
│   └── src/
│       ├── engine/deim.ts          # DEIM テキスト検出エンジン
│       ├── engine/parseq.ts        # PARSeq テキスト認識エンジン
│       └── worker/ocr.worker.ts    # Worker エントリ (ort.env.wasm.numThreads=1)
├── tests/                  # 統合テスト
├── build.rs                # ビルドスクリプト (ndlocr + opencv.js 自動取得)
├── config.json             # サーバー設定
├── DEV_POLICY.md           # 開発ポリシー
└── README.md               # 本ファイル
```

## ⚙️ 設定 (`config.json`)

```json
{
  "signaling_addr": "0.0.0.0:8080",
  "stun_addr": "0.0.0.0:3478",
  "turn_addr": "0.0.0.0:3479",
  "tls_enabled": true,
  "video_constraints": { "width": { "ideal": 1280 }, "height": { "ideal": 720 } }
}
```

## 🔧 技術的な注意事項

### COOP/COEP ヘッダー
Rust サーバーが静的ファイルに `Cross-Origin-Opener-Policy`, `Cross-Origin-Embedder-Policy`, `Cross-Origin-Resource-Policy` ヘッダーを付与します。これにより `SharedArrayBuffer` が利用可能になります。

### ONNX Runtime シングルスレッド
自己署名 HTTPS 証明書環境では `crossOriginIsolated = false` になることがあり、`SharedArrayBuffer` が使えない場合があります。  
そのため OCR Worker では **`ort.env.wasm.numThreads = 1`** を明示的に設定し、シングルスレッド WASM モードで確実に動作するようにしています。

### .gitignore 除外ファイルの自動復元
以下のファイルは `.gitignore` で除外されていますが、`cargo run` 時に `build.rs` が自動で復元します：
- `static/ndlocr/` — ndlocr-lite-wasm ビルド成果物
- `static/js/opencv.js` — OpenCV.js

---
*`DEV_POLICY.md` に従い、テストのないコードは負債とみなします。*
