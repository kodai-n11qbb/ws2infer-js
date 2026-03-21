use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub signaling_addr: String,
    pub stun_addr: String,
    pub turn_addr: String,
    pub ice_servers: Vec<IceServerConfig>,
    pub video_constraints: serde_json::Value,
    pub tls_enabled: bool,
    pub tls_cert_path: String,
    pub tls_key_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IceServerConfig {
    pub urls: Vec<String>,
}

impl Config {
    pub fn load<P: AsRef<Path>>(path: P) -> anyhow::Result<Self> {
        let content = fs::read_to_string(path)?;
        let config: Config = serde_json::from_str(&content)?;
        Ok(config)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_deserialization() {
        let json = r#"{
            "signaling_addr": "0.0.0.0:8080",
            "stun_addr": "0.0.0.0:3478",
            "turn_addr": "0.0.0.0:3479",
            "ice_servers": [{"urls": ["stun:localhost:3478"]}],
            "video_constraints": {"width": 1280},
            "tls_enabled": false,
            "tls_cert_path": "cert.pem",
            "tls_key_path": "key.pem"
        }"#;
        
        let config: Config = serde_json::from_str(json).expect("Failed to deserialize");
        assert_eq!(config.signaling_addr, "0.0.0.0:8080");
        assert_eq!(config.ice_servers[0].urls[0], "stun:localhost:3478");
        assert_eq!(config.tls_enabled, false);
    }
}
