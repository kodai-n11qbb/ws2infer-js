use cam2webrtc::room::RoomManager;
use cam2webrtc::signaling::SignalingMessage;
use proptest::prelude::*;

#[tokio::test]
async fn test_full_signaling_flow() {
    // Dependency Injection: Use MockStorage for integration testing
    let storage = cam2webrtc::persistence::MockStorage;
    let mut manager = RoomManager::new(storage);
    manager.create_room("integration-room".to_string());
    
    // 1. Sender Joins
    let join_msg = SignalingMessage::Join {
        connection_id: "sender-1".to_string(),
        is_sender: true,
    };
    
    let responses = manager.handle_message("integration-room".to_string(), join_msg).unwrap();
    // In our handle_message, RoomInfo is the first response
    assert!(matches!(responses[0], SignalingMessage::RoomInfo { .. }));
    
    // 2. Viewer Joins
    let viewer_join = SignalingMessage::Join {
        connection_id: "viewer-1".to_string(),
        is_sender: false,
    };
    
    let responses = manager.handle_message("integration-room".to_string(), viewer_join).unwrap();
    // Should get RoomInfo for viewer AND NewPeer for sender
    assert!(responses.iter().any(|m| matches!(m, SignalingMessage::RoomInfo { .. })));
    assert!(responses.iter().any(|m| matches!(m, SignalingMessage::NewPeer { .. })));
}

proptest! {
    #[test]
    fn test_handle_random_join(id in "[a-zA-Z0-9]{1,10}", is_sender in any::<bool>()) {
        let storage = cam2webrtc::persistence::MockStorage;
        let mut manager = RoomManager::new(storage);
        manager.create_room("proptest-room".to_string());

        let msg = SignalingMessage::Join {
            connection_id: id,
            is_sender,
        };

        if let Some(res) = manager.handle_message("proptest-room".to_string(), msg) {
            assert!(res.len() >= 1);
            assert!(matches!(res[0], SignalingMessage::RoomInfo { .. }));
        }
    }
}
