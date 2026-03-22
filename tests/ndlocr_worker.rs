/// Integration tests for ndlocr Worker API compliance
/// 
/// Refactor-ready Test: テストがないコードは負債とみなす (DEV_POLICY)
/// これらのテストはWorkerの初期化・データ処理パイプラインの
/// 基本的な動作を検証する補助として機能します。
///
/// Note: 完全なWorkerテストはブラウザ環境での実行が必要なため、
/// JavaScriptサイド（static/test-ndlocr.html）の手動テストと
/// 組み合わせて使用してください。

#[cfg(test)]
mod ndlocr_worker_tests {
    use std::path::Path;

    /// テスト: static/ndlocr が存在し、必要なアセットがある
    #[test]
    fn test_ndlocr_build_artifacts_exist() {
        let static_ndlocr = Path::new("static/ndlocr");
        assert!(
            static_ndlocr.exists(),
            "static/ndlocr directory must exist (run 'cargo build' first)"
        );

        // Check for critical assets
        let assets = [
            "assets/ocr.worker.js",
            "assets/index-NWnWRICn.js",
            "assets/ort-wasm-simd-threaded.jsep-CVw3nYo7.wasm",
            "models/",
        ];

        for asset in &assets {
            let path = static_ndlocr.join(asset);
            assert!(
                path.exists(),
                "Expected asset {} to exist at {}",
                asset,
                path.display()
            );
        }
    }

    /// テスト: Worker URLが正しく設定されている
    #[test]
    fn test_worker_url_configuration() {
        // Load test HTML to verify URL consistency
        let test_html = std::fs::read_to_string("static/test-ndlocr.html")
            .expect("Failed to read test-ndlocr.html");

        // Verify WORKER_CONFIG is properly defined
        assert!(
            test_html.contains("const WORKER_CONFIG"),
            "WORKER_CONFIG must be defined in test HTML"
        );

        assert!(
            test_html.contains("'/ndlocr/assets/ocr.worker.js'"),
            "Worker URL must point to /ndlocr/assets/ocr.worker.js"
        );

        assert!(
            test_html.contains("'/ndlocr/models'"),
            "Models URL must point to /ndlocr/models"
        );
    }

    /// テスト: WorkerManager が共通化されている (Rule of Three)
    #[test]
    fn test_worker_manager_centralization() {
        let test_html = std::fs::read_to_string("static/test-ndlocr.html")
            .expect("Failed to read test-ndlocr.html");

        // Verify WorkerManager class exists
        assert!(
            test_html.contains("class WorkerManager"),
            "WorkerManager class must be defined for centralized Worker management"
        );

        // Verify DI: configuration is injected, not hardcoded
        assert!(
            test_html.contains("this.config.workerUrl"),
            "WorkerManager must use injected config for worker URL"
        );

        // Verify worker creation is centralized
        let worker_creation_count = test_html.matches("workerManager.createWorker(").count();
        assert!(
            worker_creation_count >= 3,
            "WorkerManager.createWorker() should be called in multiple places (testWorker, startCamera, testOCR)"
        );
    }

    /// テスト: Worker URLが複数箇所にハードコードされていない
    #[test]
    fn test_no_hardcoded_worker_urls() {
        let test_html = std::fs::read_to_string("static/test-ndlocr.html")
            .expect("Failed to read test-ndlocr.html");

        // Count direct Worker instantiation (should only be in WorkerManager)
        let new_worker_count = test_html.matches("new Worker(").count();
        assert_eq!(
            new_worker_count, 1,
            "new Worker() should only appear once (in WorkerManager class). Found {}",
            new_worker_count
        );
    }

    /// テスト: Worker lifecycle management (cleanup on completion/error)
    #[test]
    fn test_worker_lifecycle_management() {
        let test_html = std::fs::read_to_string("static/test-ndlocr.html")
            .expect("Failed to read test-ndlocr.html");

        // Verify cleanup happens on completion in WorkerManager
        assert!(
            test_html.contains("this.releaseWorker(id)"),
            "Workers must be released internally via releaseWorker(id)"
        );

        // Verify cleanup is called from callers too (for manual release)
        let release_count = test_html.matches("workerManager.releaseWorker").count();
        assert!(
            release_count >= 3,
            "Worker cleanup should be called on success paths in callers"
        );
    }

    /// テスト: 設定が Dependency Injection で提供されている
    #[test]
    fn test_dependency_injection_pattern() {
        let test_html = std::fs::read_to_string("static/test-ndlocr.html")
            .expect("Failed to read test-ndlocr.html");

        // Verify configuration object
        assert!(
            test_html.contains("const WORKER_CONFIG = {"),
            "Configuration must be defined as WORKER_CONFIG object"
        );

        // Verify it's passed to WorkerManager (DI)
        assert!(
            test_html.contains("new WorkerManager(WORKER_CONFIG)"),
            "WorkerManager must receive configuration via DI"
        );

        // Verify no hardcoded paths in WorkerManager instantiation
        assert!(
            !test_html.contains("new WorkerManager('/ndlocr"),
            "Paths must not be hardcoded; they should come from config"
        );
    }

    /// テスト: build.rs がworkerファイルを正しく配置している
    #[test]
    fn test_build_script_worker_placement() {
        // Verify build.rs creates the symlink/copy
        let build_rs = std::fs::read_to_string("build.rs")
            .expect("Failed to read build.rs");

        assert!(
            build_rs.contains("ocr.worker"),
            "build.rs must copy/link ocr.worker files"
        );

        // Verify the wildcard copy is being used (flexible to hash changes)
        assert!(
            build_rs.contains("ocr.worker-*.js"),
            "build.rs must use wildcard pattern to handle hashed filenames"
        );
    }

    /// テスト: ProgressTracker がタイムアウトを正しく検出する
    #[test]
    fn test_progress_timeout_detection() {
        let test_html = std::fs::read_to_string("static/test-ndlocr.html")
            .expect("Failed to read test-ndlocr.html");

        // Verify ProgressTracker class exists
        assert!(
            test_html.contains("class ProgressTracker"),
            "ProgressTracker class must exist for progress monitoring"
        );

        // Verify timeout configuration exists
        assert!(
            test_html.contains("initTimeout:"),
            "initTimeout must be configurable"
        );

        assert!(
            test_html.contains("progressTimeout:"),
            "progressTimeout must be configurable"
        );

        // Verify progress tracking
        assert!(
            test_html.contains("recordProgress"),
            "Progress must be recorded to detect hangs"
        );
    }

    /// テスト: Worker 例外ハンドリングが統一されている
    #[test]
    fn test_error_handling_consistency() {
        let test_html = std::fs::read_to_string("static/test-ndlocr.html")
            .expect("Failed to read test-ndlocr.html");

        // Verify worker.onerror is attached in WorkerManager
        assert!(
            test_html.contains("worker.onerror ="),
            "worker.onerror must be attached in WorkerManager"
        );

        // Verify errors log with ❌ prefix
        let error_log_count = test_html.matches("log(`❌").count();
        assert!(
            error_log_count > 0,
            "Errors must be logged with visual indicator"
        );

        // Verify callers provide UI feedback for errors via createWorker callback
        assert!(
            test_html.contains("createWorker("),
            "Callers must use createWorker with handlers"
        );
        
        // Count error log occurrences total (should be in WorkerManager and some detailed ones in callers)
        assert!(error_log_count >= 3, "Total error logging points should be >= 3");
    }

    /// テスト: 進捗メッセージ記録が集中管理されている
    #[test]
    fn test_progress_tracking_in_all_tests() {
        let test_html = std::fs::read_to_string("static/test-ndlocr.html")
            .expect("Failed to read test-ndlocr.html");

        // Verify progress recording is done in WorkerManager message handler
        assert!(
            test_html.contains("this.recordProgress(id, msg)"),
            "Progress must be recorded in WorkerManager"
        );

        // Verify specific progress types are tracked
        assert!(
            test_html.contains("'init-progress'"),
            "init-progress messages must be tracked"
        );

        assert!(
            test_html.contains("'recognize-progress'"),
            "Intermediate progress messages must be tracked"
        );
    }
}
