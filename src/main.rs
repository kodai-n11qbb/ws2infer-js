use cam2webrtc::config::Config;
use log::error;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    env_logger::init();

    let config = Config::load("config.json").unwrap_or_else(|e| {
        error!("Failed to load config.json: {}. Using defaults.", e);
        Config {
            signaling_addr: "0.0.0.0:8080".to_string(),
            stun_addr: "0.0.0.0:3478".to_string(),
            turn_addr: "0.0.0.0:3479".to_string(),
            ice_servers: vec![cam2webrtc::config::IceServerConfig { urls: vec!["stun:localhost:3478".to_string()] }],
            video_constraints: serde_json::json!({
                "width": { "ideal": 1280 },
                "height": { "ideal": 720 }
            }),
            tls_enabled: true,
            tls_cert_path: "cert.pem".to_string(),
            tls_key_path: "key.pem".to_string(),
        }
    });

    cam2webrtc::run_server(config).await
}
