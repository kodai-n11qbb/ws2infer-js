# テストスイート / Test Suite

このディレクトリにはws2infer-jsプロジェクトの包括的なテストが含まれています。言語ごとに分類され、サーバー側、クライアント側、統合、パフォーマンスの各側面をカバーしています。

This directory contains comprehensive tests for the ws2infer-js project, categorized by language and covering server-side, client-side, integration, and performance aspects.

## 📁 テスト構成 / Test Structure

### 🔧 Rustサーバーテスト / Rust Server Tests
**ファイル**: `rust_server_tests.rs`

サーバー側のRustコードをテストします：
- ルーム作成・管理
- WebSocket接続処理
- シグナリングメッセージのシリアライズ
- 永続化レイヤー（SQLite/JSONL）
- STUN/TURNサーバー設定
- APIエンドポイント
- エラーハンドリング

**実行方法**:
```bash
cargo test --test rust_server_tests
```

### 🌐 JavaScriptクライアントテスト / JavaScript Client Tests
**ファイル**: `javascript_client_tests.js`

クライアント側のJavaScriptコードをテストします：
- WebRTC接続（RTCPeerConnection）
- TensorFlow.js推論
- WebSocket通信
- UIコンポーネント
- ビデオ制約
- キャンバス描画
- データシリアライズ

**実行方法**:
```bash
# Node.js環境
node tests/javascript_client_tests.js

# ブラウザ環境
# HTMLファイルにスクリプトをインクルードして実行
```

### 🔗 統合テスト / Integration Tests
**ファイル**: `integration_tests.rs`

完全なシステム統合をテストします：
- ルームライフサイクル（作成→参加→退出）
- シグナリングメッセージフロー
- 推論データの永続化
- マルチルーム分離
- 同時実行操作
- エラー回復
- WebSocketメッセージ処理
- パフォーマンスメトリクス

**実行方法**:
```bash
cargo test --test integration_tests
```

### ⚡ パフォーマンステスト / Performance Tests
**ファイル**: `performance_tests.js`

システムのパフォーマンス特性をテストします：
- 推論パフォーマンスベースライン
- 高フレームレート性能
- メモリストレステスト
- スケーラビリティテスト
- ネットワーク遅延の影響
- 長時間実行安定性

**実行方法**:
```bash
# Node.js環境
node tests/performance_tests.js

# ブラウザ環境
window.runPerformanceTests()
```

## 🚀 実行方法 / Running Tests

### すべてのRustテスト
```bash
cargo test
```

### すべてのJavaScriptテスト
```bash
# インストールが必要な場合
npm install

# クライアントテスト
node tests/javascript_client_tests.js

# パフォーマンステスト
node tests/performance_tests.js
```

### 特定のテストカテゴリ
```bash
# サーバーテストのみ
cargo test --test rust_server_tests

# 統合テストのみ
cargo test --test integration_tests

# 特定のテスト関数
cargo test test_room_creation
```

## 📊 テストカバレッジ / Test Coverage

### サーバー側機能 / Server-side Features
- ✅ ルーム管理（作成、参加、退出）
- ✅ WebSocketシグナリング
- ✅ STUN/TURNサーバー
- ✅ SQLite/JSONL永続化
- ✅ REST APIエンドポイント
- ✅ エラーハンドリング
- ✅ 同時実行処理

### クライアント側機能 / Client-side Features
- ✅ WebRTCピア接続
- ✅ TensorFlow.js物体検出
- ✅ リアルタイムビデオ処理
- ✅ UI制御（推論パラメータ）
- ✅ キャンバス描画
- ✅ パフォーマンス監視

### 統合シナリオ / Integration Scenarios
- ✅ 完全なルームライフサイクル
- ✅ マルチクライアント通信
- ✅ 推論結果の保存と取得
- ✅ ネットワーク分離
- ✅ エラー回復

### パフォーマンス特性 / Performance Characteristics
- ✅ 推論速度（<100ms目標）
- ✅ フレームレート（30-60 FPS）
- ✅ メモリ使用量
- ✅ スケーラビリティ（最大20クライアント）
- ✅ 長時間実行安定性

## 🛠️ テスト環境設定 / Test Environment Setup

### Rust依存関係
```toml
[dev-dependencies]
tokio-test = "0.4"
tempfile = "3.8"
```

### JavaScriptモック
テスト環境では以下のモックを使用：
- `WebSocket` - WebSocket API
- `RTCPeerConnection` - WebRTC API
- `tf` - TensorFlow.js
- `performance.memory` - メモリ監視

## 📈 継続的インテグレーション / Continuous Integration

### GitHub Actions設定例
```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v2
    - name: Install Rust
      uses: actions-rs/toolchain@v1
      with:
        toolchain: stable
    - name: Run Rust tests
      run: cargo test
    - name: Setup Node.js
      uses: actions/setup-node@v2
      with:
        node-version: '18'
    - name: Run JavaScript tests
      run: |
        npm install
        node tests/javascript_client_tests.js
        node tests/performance_tests.js
```

## 🔍 トラブルシューティング / Troubleshooting

### 一般的な問題
1. **ポート競合**: テストが異なるポートを使用することを確認
2. **タイミングの問題**: 非同期テストで適切な待機時間を設定
3. **メモリリーク**: パフォーマンステストでメモリ使用量を監視
4. **ネットワーク接続**: ローカル環境でのWebSocket接続を確認

### デバッグ方法
```bash
# 詳細なログ出力
RUST_LOG=debug cargo test

# JavaScriptテストの詳細出力
node tests/javascript_client_tests.js --verbose
```

## 📝 テスト結果の解釈 / Interpreting Test Results

### 成功基準
- **推論時間**: 平均 < 100ms
- **フレームレート**: 30-60 FPS
- **メモリ使用量**: 安定（リークなし）
- **エラーレート**: < 1%
- **同時接続**: 最大20クライアントまでサポート

### パフォーマンス目標
- **レイテンシ**: < 200ms（エンドツーエンド）
- **スループット**: > 10 推論/秒/クライアント
- **メモリ**: < 500MB（ピーク時）
- **CPU使用率**: < 80%（平均）

---

## 📚 詳細情報 / Additional Information

各テストファイルには詳細なコメントと説明が含まれています。テストの実行方法や結果の解釈について不明点がある場合は、各ファイルのドキュメントを参照してください。

Each test file contains detailed comments and explanations. For questions about test execution or result interpretation, please refer to the documentation in each respective file.
