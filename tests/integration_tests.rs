use cam2webrtc::room::RoomManager;
use cam2webrtc::signaling::{SignalingMessage, SignalingMessageType};

#[tokio::test]
async fn test_full_signaling_flow() {
    // Dependency Injection: Provide test-specific paths
    let mut manager = RoomManager::new("test_db.db".to_string(), "test_jsonl.jsonl".to_string());
    manager.create_room("integration-room".to_string());
    
    // 1. Sender Joins
    let join_msg = SignalingMessage {
        message_type: SignalingMessageType::Join,
        connection_id: Some("sender-1".to_string()),
        source_sender_id: None,
        sender_id: None,
        offer_id: None,
        data: None,
        is_sender: Some(true),
    };
    
    let responses = manager.handle_message("integration-room".to_string(), join_msg).unwrap();
    assert_eq!(responses[0].message_type, SignalingMessageType::RoomInfo);
    
    // 2. Viewer Joins
    let viewer_join = SignalingMessage {
        message_type: SignalingMessageType::Join,
        connection_id: Some("viewer-1".to_string()),
        source_sender_id: None,
        sender_id: None,
        offer_id: None,
        data: None,
        is_sender: Some(false),
    };
    
    let responses = manager.handle_message("integration-room".to_string(), viewer_join).unwrap();
    // Should get RoomInfo for viewer AND NewPeer for sender
    assert!(responses.iter().any(|m| m.message_type == SignalingMessageType::RoomInfo));
    assert!(responses.iter().any(|m| m.message_type == SignalingMessageType::NewPeer));
}
