use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SignalingMessage {
    Join {
        connection_id: String,
        is_sender: bool,
    },
    Leave {
        connection_id: String,
        data: Value,
    },
    Offer {
        connection_id: Option<String>,
        sender_id: String,
        offer_id: Option<String>,
        data: Value,
    },
    Answer {
        connection_id: Option<String>,
        sender_id: String,
        data: Value,
    },
    IceCandidate {
        connection_id: Option<String>,
        sender_id: String,
        data: Value,
    },
    RoomInfo {
        connection_id: String,
        data: Value,
    },
    Error {
        connection_id: String,
        data: Value,
    },
    InferenceResult {
        source_sender_id: String,
        data: Option<Value>,
    },
    InferenceUpdate {
        connection_id: String,
        data: Value,
    },
    NewPeer {
        connection_id: String,
        data: Value,
    },
}

impl SignalingMessage {
    pub fn connection_id(&self) -> Option<&String> {
        match self {
            SignalingMessage::Join { connection_id, .. } => Some(connection_id),
            SignalingMessage::Leave { connection_id, .. } => Some(connection_id),
            SignalingMessage::Offer { connection_id, .. } => connection_id.as_ref(),
            SignalingMessage::Answer { connection_id, .. } => connection_id.as_ref(),
            SignalingMessage::IceCandidate { connection_id, .. } => connection_id.as_ref(),
            SignalingMessage::RoomInfo { connection_id, .. } => Some(connection_id),
            SignalingMessage::Error { connection_id, .. } => Some(connection_id),
            SignalingMessage::InferenceResult { .. } => None,
            SignalingMessage::InferenceUpdate { connection_id, .. } => Some(connection_id),
            SignalingMessage::NewPeer { connection_id, .. } => Some(connection_id),
        }
    }

    #[allow(dead_code)]
    pub fn new_join(connection_id: String, is_sender: bool) -> Self {
        SignalingMessage::Join { connection_id, is_sender }
    }
    
    #[allow(dead_code)]
    pub fn new_offer(
        connection_id: String,
        sender_id: String,
        sdp: Value,
    ) -> Self {
        SignalingMessage::Offer {
            connection_id: Some(connection_id),
            sender_id,
            offer_id: None,
            data: sdp,
        }
    }
    
    #[allow(dead_code)]
    pub fn new_answer(
        connection_id: String,
        sender_id: String,
        sdp: Value,
    ) -> Self {
        SignalingMessage::Answer {
            connection_id: Some(connection_id),
            sender_id,
            data: sdp,
        }
    }
    
    #[allow(dead_code)]
    pub fn new_ice_candidate(
        connection_id: String,
        sender_id: String,
        candidate: Value,
    ) -> Self {
        SignalingMessage::IceCandidate {
            connection_id: Some(connection_id),
            sender_id,
            data: candidate,
        }
    }
    
    #[allow(dead_code)]
    pub fn new_error(connection_id: String, error: String) -> Self {
        SignalingMessage::Error {
            connection_id,
            data: serde_json::json!({ "error": error }),
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

use crate::persistence::InferenceStorage;

pub struct SignalingServer<S: InferenceStorage> {
    room_manager: Arc<RwLock<RoomManager<S>>>,
    clients: Clients,
}

impl<S: InferenceStorage> SignalingServer<S> {
    pub fn new(room_manager: Arc<RwLock<RoomManager<S>>>, clients: Clients) -> Self {
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
                                    if let Some(cid) = signaling_msg.connection_id() {
                                        info!("Registering new connection: {}", cid);
                                        current_connection_id = Some(cid.clone());
                                        self.clients.write().await.insert(cid.clone(), tx.clone());
                                    }
                                }

                                let mut manager = self.room_manager.write().await;
                                
                                // Ensure room exists (Implicit creation on JOIN)
                                if !manager.rooms.contains_key(&room_id) {
                                    if let SignalingMessage::Join { .. } = signaling_msg {
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
                                            if let Some(target_id) = response.connection_id() {
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
                        if let Some(target_id) = response.connection_id() {
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
        if let SignalingMessage::Offer { .. } = msg {
            // ok
        } else {
            panic!("Expected Offer message variant");
        }
        assert_eq!(msg.connection_id(), Some(&"c1".to_string()));
    }
}
