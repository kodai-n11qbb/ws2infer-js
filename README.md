# Cam2WebRTC

Rustで実装されたWebRTCシグナリングサーバー。カメラ映像をリアルタイム配信するための完全なオフライン対応システム。

## 機能

- **1onN配信 (P2P Mesh)**: 1対多のリアルタイム映像配信（Mesh方式）
- **内蔵STUNサーバー**: ローカルIPアドレス自動検出
- **内蔵TURNサーバー**: 同一LAN内での中継対応
- **外部設定ファイル**: `config.json` による柔軟な構成変更
- **WebSocketシグナリング**: 低遅延な通信
- **完全オフライン運用**: インターネット接続不要

## システムアーキテクチャ

```
Sender (HTML) ←→ Rust Signaling Server ←→ Viewer (HTML)
                    ↓
            STUN/TURN Servers
```

## セットアップ

### 1. ビルド

```bash
cargo build --release
```

### 2. 設定

`config.json` を必要に応じて編集します。

```json
{
  "signaling_addr": "0.0.0.0:8080",
  "stun_addr": "0.0.0.0:3478",
  "turn_addr": "0.0.0.0:3479",
  "ice_servers": [
    {
      "urls": ["stun:localhost:3478"]
    }
  ],
  "video_constraints": {
    "width": { "ideal": 1280 },
    "height": { "ideal": 720 }
  },
  "tls_enabled": true,
  "tls_cert_path": "cert.pem",
  "tls_key_path": "key.pem"
}
```

注意: 初回起動時に自己署名証明書(`cert.pem`, `key.pem`)が自動生成されます。ブラウザでアクセスする際は「詳細設定」から「localhost（またはIP）に移動する」を選択して警告を続行してください。

### 3. 実行

```bash
cargo run
```

サーバーが設定されたアドレス（デフォルトは `http://localhost:8080`）で起動します。

### 4. アクセス

- **Sender**: `https://localhost:8080/sender.html`
- **Viewer**: `https://localhost:8080/viewer.html`

## 使用方法

### Sender側

1. `sender.html` にアクセス
2. 「カメラ開始」をクリック（`config.json` の解像度設定が適用されます）
3. 「ルーム作成」をクリック
4. 「配信開始」をクリック
5. 表示されたルームIDをViewerに共有

### Viewer側

1. `viewer.html` にアクセス
2. ルームIDを入力
3. 「ルームに接続」をクリック
4. 自動的に配信が開始される

**自動接続モード**: 常に利用可能なルームを自動検出して接続を試みます。

## 技術仕様

### サーバー技術

- **Rust**: 高性能なメモリ安全な実装
- **Tokio**: 非同期ランタイム
- **Warp**: HTTP/WebSocketフレームワーク
- **STUN/TURN**: RFC 5389/5766準拠（内蔵実装）

### クライアント技術

- **WebRTC**: P2P通信 (Mesh構造)
- **WebSocket**: シグナリング
- **MediaStream API**: カメラ/マイクアクセス

### デフォルトネットワーク設定

- **Signaling/HTTP**: 8080
- **STUN**: 3478
- **TURN**: 3479

## API

### REST API

#### ルーム作成
`POST /api/rooms`

#### ルーム確認
`GET /api/rooms/{room_id}`

#### 設定取得
`GET /api/config`
フロントエンドが `ice_servers` や解像度設定を取得するために使用します。

### WebSocket API

#### 接続
`ws://{addr}/ws/{room_id}`

## 開発

### プロジェクト構造

```
.
├── src/
│   ├── main.rs          # エントリーポイント
│   ├── signaling.rs     # シグナリングメッセージ定義
│   ├── room.rs          # ルーム・接続管理
│   ├── stun.rs          # STUNサーバー実装
│   ├── turn.rs          # TURNサーバー実装
│   └── config.rs        # 設定ファイル管理
├── static/
│   ├── sender.html      # 配信者用クライアント
│   └── viewer.html      # 視聴者用クライアント
├── config.json          # プロジェクト設定
└── Cargo.toml           # 依存関係定義
```

## ライセンス

[MIT License](LICENSE)

## 貢献

プルリクエストを歓迎します。バグ報告や機能要望はIssueで受け付けています。
