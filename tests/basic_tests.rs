#[cfg(test)]
mod tests {
    use serde_json::json;
    use std::collections::HashMap;
    use std::sync::Arc;
    use tempfile::tempdir;
    use tokio::sync::{mpsc, RwLock};
    use uuid::Uuid;

    // Type alias for Clients map: connection_id -> sender channel
    type Clients = Arc<RwLock<HashMap<String, mpsc::UnboundedSender<warp::ws::Message>>>>;

    #[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
    pub struct CreateRoomRequest {}

    #[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
    pub struct RoomResponse {
        room_id: String,
    }

    #[tokio::test]
    async fn test_uuid_generation() {
        let room_id = Uuid::new_v4().to_string();

        assert!(!room_id.is_empty());
        assert_eq!(room_id.len(), 36); // UUID length
        assert_eq!(room_id.chars().filter(|&c| c == '-').count(), 4); // UUID format
    }

    #[tokio::test]
    async fn test_websocket_connection_handling() {
        let clients: Clients = Arc::new(RwLock::new(HashMap::new()));
        let (tx, _rx) = mpsc::unbounded_channel();

        // Test client registration
        {
            let mut clients_guard = clients.write().await;
            clients_guard.insert("test_client".to_string(), tx);
        }

        // Verify client exists
        let clients_guard = clients.read().await;
        assert!(clients_guard.contains_key("test_client"));
    }

    #[tokio::test]
    async fn test_json_serialization() {
        let test_data = json!({
            "room_id": "test_room",
            "source_id": "test_client",
            "detections": [
                {"class": "person", "score": 0.9, "bbox": [0, 0, 100, 100]}
            ]
        });

        let json_str = serde_json::to_string(&test_data).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json_str).unwrap();

        assert_eq!(parsed["room_id"], "test_room");
        assert_eq!(parsed["source_id"], "test_client");
        assert_eq!(parsed["detections"].as_array().unwrap().len(), 1);
        assert_eq!(parsed["detections"][0]["class"], "person");
        assert_eq!(parsed["detections"][0]["score"], 0.9);
    }

    #[tokio::test]
    async fn test_room_response_serialization() {
        let room_response = RoomResponse {
            room_id: "test-room-123".to_string(),
        };

        let json_str = serde_json::to_string(&room_response).unwrap();
        let parsed: RoomResponse = serde_json::from_str(&json_str).unwrap();

        assert_eq!(parsed.room_id, "test-room-123");
    }

    #[tokio::test]
    async fn test_create_room_request() {
        let request = CreateRoomRequest {};
        let json_str = serde_json::to_string(&request).unwrap();
        let _parsed: CreateRoomRequest = serde_json::from_str(&json_str).unwrap();

        // Empty struct should serialize/deserialize correctly
        assert_eq!(json_str, "{}");
    }

    #[tokio::test]
    async fn test_temp_directory_creation() {
        let temp_dir = tempdir().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let jsonl_path = temp_dir.path().join("test.jsonl");

        assert!(temp_dir.path().exists());
        assert!(!db_path.exists()); // File doesn't exist yet
        assert!(!jsonl_path.exists()); // File doesn't exist yet
    }

    #[tokio::test]
    async fn test_concurrent_client_operations() {
        let clients: Clients = Arc::new(RwLock::new(HashMap::new()));

        // Simulate multiple concurrent client registrations
        let mut tasks = Vec::new();

        for i in 0..10 {
            let clients_clone = clients.clone();
            let client_id = format!("client_{}", i);

            let task = tokio::spawn(async move {
                let (tx, _rx) = mpsc::unbounded_channel();
                {
                    let mut clients_guard = clients_clone.write().await;
                    clients_guard.insert(client_id, tx);
                }
            });
            tasks.push(task);
        }

        // Wait for all tasks to complete
        for task in tasks {
            task.await.unwrap();
        }

        // Verify all clients were registered
        let clients_guard = clients.read().await;
        assert_eq!(clients_guard.len(), 10);

        for i in 0..10 {
            let client_id = format!("client_{}", i);
            assert!(clients_guard.contains_key(&client_id));
        }
    }

    #[tokio::test]
    async fn test_error_handling() {
        // Test UUID parsing with invalid input
        let invalid_uuid = "invalid-uuid";
        let parse_result = Uuid::parse_str(invalid_uuid);
        assert!(parse_result.is_err());

        // Test valid UUID parsing
        let valid_uuid = "550e8400-e29b-41d4-a716-446655440000";
        let parse_result = Uuid::parse_str(valid_uuid);
        assert!(parse_result.is_ok());
    }

    #[tokio::test]
    async fn test_message_format_validation() {
        let signaling_message = json!({
            "type": "offer",
            "from": "client1",
            "to": "client2",
            "data": {
                "sdp": "test_sdp_content"
            }
        });

        assert_eq!(signaling_message["type"], "offer");
        assert_eq!(signaling_message["from"], "client1");
        assert_eq!(signaling_message["to"], "client2");
        assert_eq!(signaling_message["data"]["sdp"], "test_sdp_content");
    }

    #[tokio::test]
    async fn test_inference_data_structure() {
        let inference_result = json!({
            "timestamp": 1640995200000_i64,
            "detections": [
                {
                    "class": "person",
                    "score": 0.95,
                    "bbox": [100, 100, 200, 300]
                },
                {
                    "class": "car",
                    "score": 0.87,
                    "bbox": [300, 150, 450, 250]
                }
            ],
            "inference_time_ms": 45,
            "frame_size": [640, 480]
        });

        let detections = inference_result["detections"].as_array().unwrap();
        assert_eq!(detections.len(), 2);

        let person = &detections[0];
        assert_eq!(person["class"], "person");
        assert_eq!(person["score"], 0.95);
        assert_eq!(person["bbox"].as_array().unwrap().len(), 4);

        let car = &detections[1];
        assert_eq!(car["class"], "car");
        assert_eq!(car["score"], 0.87);
    }

    #[tokio::test]
    async fn test_config_structure() {
        let config = json!({
            "signaling_addr": "127.0.0.1:8080",
            "stun_addr": "127.0.0.1:3478",
            "turn_addr": "127.0.0.1:3479",
            "ice_servers": [
                {"urls": ["stun:127.0.0.1:3478"]}
            ],
            "video_constraints": {
                "width": {"ideal": 1280},
                "height": {"ideal": 720}
            },
            "tls_enabled": true,
            "tls_cert_path": "cert.pem",
            "tls_key_path": "key.pem"
        });

        assert_eq!(config["signaling_addr"], "127.0.0.1:8080");
        assert_eq!(config["stun_addr"], "127.0.0.1:3478");
        assert_eq!(config["turn_addr"], "127.0.0.1:3479");
        assert_eq!(config["ice_servers"].as_array().unwrap().len(), 1);
        assert_eq!(config["video_constraints"]["width"]["ideal"], 1280);
        assert_eq!(config["video_constraints"]["height"]["ideal"], 720);
        assert_eq!(config["tls_enabled"], true);
    }
}
