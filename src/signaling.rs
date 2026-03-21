use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SignalingMessage {
    #[serde(rename = "type")]
    pub message_type: SignalingMessageType,
    pub connection_id: Option<String>,
    pub source_sender_id: Option<String>,
    pub sender_id: Option<String>,
    pub offer_id: Option<String>,
    pub data: Option<Value>,
    pub is_sender: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SignalingMessageType {
    Join,
    Leave,
    Offer,
    Answer,
    IceCandidate,
    RoomInfo,
    Error,
    InferenceResult,
    InferenceUpdate,
    NewPeer,
}

impl SignalingMessage {
    #[allow(dead_code)]
    pub fn new_join(connection_id: String, is_sender: bool) -> Self {
        Self {
            message_type: SignalingMessageType::Join,
            connection_id: Some(connection_id),
            source_sender_id: None,
            sender_id: None,
            offer_id: None,
            data: None,
            is_sender: Some(is_sender),
        }
    }
    
    #[allow(dead_code)]
    pub fn new_offer(
        connection_id: String,
        sender_id: String,
        sdp: Value,
    ) -> Self {
        Self {
            message_type: SignalingMessageType::Offer,
            connection_id: Some(connection_id),
            source_sender_id: None,
            sender_id: Some(sender_id),
            offer_id: None,
            data: Some(sdp),
            is_sender: Some(true),
        }
    }
    
    #[allow(dead_code)]
    pub fn new_answer(
        connection_id: String,
        sender_id: String,
        sdp: Value,
    ) -> Self {
        Self {
            message_type: SignalingMessageType::Answer,
            connection_id: Some(connection_id),
            source_sender_id: None,
            sender_id: Some(sender_id),
            offer_id: None,
            data: Some(sdp),
            is_sender: Some(false),
        }
    }
    
    #[allow(dead_code)]
    pub fn new_ice_candidate(
        connection_id: String,
        sender_id: String,
        candidate: Value,
    ) -> Self {
        Self {
            message_type: SignalingMessageType::IceCandidate,
            connection_id: Some(connection_id),
            source_sender_id: None,
            sender_id: Some(sender_id),
            offer_id: None,
            data: Some(candidate),
            is_sender: None,
        }
    }
    
    #[allow(dead_code)]
    pub fn new_error(connection_id: String, error: String) -> Self {
        Self {
            message_type: SignalingMessageType::Error,
            connection_id: Some(connection_id),
            source_sender_id: None,
            sender_id: None,
            offer_id: None,
            data: Some(serde_json::json!({
                "error": error
            })),
            is_sender: None,
        }
    }
}

use std::sync::Arc;
use tokio::sync::{RwLock, mpsc};
use warp::ws::{WebSocket, Message};
use futures_util::{SinkExt, StreamExt};
use log::{info, error, debug};
use crate::room::RoomManager;
use crate::Clients;

pub struct SignalingServer {
    room_manager: Arc<RwLock<RoomManager>>,
    clients: Clients,
}

impl SignalingServer {
    pub fn new(room_manager: Arc<RwLock<RoomManager>>, clients: Clients) -> Self {
        Self {
            room_manager,
            clients,
        }
    }

    pub async fn handle_connection(&self, socket: WebSocket, room_id: String) {
        let (mut user_ws_tx, mut user_ws_rx) = socket.split();
        let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
        
        // Sender task
        tokio::task::spawn(async move {
            while let Some(message) = rx.recv().await {
                if let Err(e) = user_ws_tx.send(message).await {
                    error!("Websocket send error: {}", e);
                    break;
                }
            }
        });

        let mut current_connection_id: Option<String> = None;
        
        // Receiver task
        while let Some(result) = user_ws_rx.next().await {
            match result {
                Ok(msg) => {
                    if let Ok(text) = msg.to_str() {
                        match serde_json::from_str::<SignalingMessage>(text) {
                            Ok(signaling_msg) => {
                                // Register client on first message with connection_id
                                if current_connection_id.is_none() {
                                    if let Some(ref cid) = signaling_msg.connection_id {
                                        info!("Registering new connection: {}", cid);
                                        current_connection_id = Some(cid.clone());
                                        self.clients.write().await.insert(cid.clone(), tx.clone());
                                    }
                                }

                                let mut manager = self.room_manager.write().await;
                                
                                // Ensure room exists (Implicit creation on JOIN)
                                if !manager.rooms.contains_key(&room_id) {
                                    if signaling_msg.message_type == SignalingMessageType::Join {
                                        info!("Room {} not found, auto-creating for first connection", room_id);
                                        manager.create_room(room_id.clone());
                                    } else {
                                        error!("Message for non-existent room: {}", room_id);
                                        return; // Closes socket
                                    }
                                }

                                if let Some(responses) = manager.handle_message(room_id.clone(), signaling_msg) {
                                    for response in responses {
                                        if let Ok(response_text) = serde_json::to_string(&response) {
                                            if let Some(target_id) = &response.connection_id {
                                                let clients_guard = self.clients.read().await;
                                                if let Some(target_tx) = clients_guard.get(target_id) {
                                                    let _ = target_tx.send(Message::text(response_text));
                                                } else {
                                                    debug!("Target client {} not found for response", target_id);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            Err(e) => {
                                error!("Signaling JSON parse error: {}. Received text: {}", e, text);
                            }
                        }
                    } else if msg.is_ping() {
                        debug!("Received WS Ping");
                    }
                }
                Err(e) => {
                    error!("WebSocket error: {}", e);
                    break;
                }
            }
        }
        
        // Cleanup on disconnect
        if let Some(cid) = current_connection_id {
            let mut manager = self.room_manager.write().await;
            if let Some(responses) = manager.remove_connection(&room_id, &cid) {
                for response in responses {
                    if let Ok(response_text) = serde_json::to_string(&response) {
                        if let Some(target_id) = &response.connection_id {
                            let clients_guard = self.clients.read().await;
                            if let Some(target_tx) = clients_guard.get(target_id) {
                                let _ = target_tx.send(Message::text(response_text));
                            }
                        }
                    }
                }
            }
            self.clients.write().await.remove(&cid);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_signaling_message_serialization() {
        let msg = SignalingMessage::new_join("client123".to_string(), true);
        let serialized = serde_json::to_string(&msg).expect("Failed to serialize");
        
        // Assert json structure
        assert!(serialized.contains("\"type\":\"join\""));
        assert!(serialized.contains("\"connection_id\":\"client123\""));
        assert!(serialized.contains("\"is_sender\":true"));
    }

    #[test]
    fn test_signaling_message_deserialization() {
        let json = r#"{
            "type": "offer",
            "connection_id": "c1",
            "sender_id": "s1",
            "data": {"sdp": "test-sdp"}
        }"#;
        
        let msg: SignalingMessage = serde_json::from_str(json).expect("Failed to deserialize");
        match msg.message_type {
            SignalingMessageType::Offer => (),
            _ => panic!("Expected Offer message type"),
        }
        assert_eq!(msg.connection_id, Some("c1".to_string()));
        assert_eq!(msg.sender_id, Some("s1".to_string()));
    }
}
