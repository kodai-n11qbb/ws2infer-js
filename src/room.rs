use std::collections::HashMap;
use uuid::Uuid;
use serde_json::Value;
use crate::signaling::{SignalingMessage, SignalingMessageType};
use log::error;
use crate::persistence;

#[derive(Debug, Clone)]
pub struct Room {
    #[allow(dead_code)]
    pub id: String,
    pub connections: HashMap<String, ConnectionInfo>,
    pub offers: HashMap<String, SignalingMessage>,
}

#[derive(Debug, Clone)]
pub struct ConnectionInfo {
    #[allow(dead_code)]
    pub id: String,
    pub is_sender: bool,
    #[allow(dead_code)]
    pub connected_at: chrono::DateTime<chrono::Utc>,
}

impl Room {
    pub fn new(id: String) -> Self {
        Self {
            id,
            connections: HashMap::new(),
            offers: HashMap::new(),
        }
    }
    
    pub fn add_connection(&mut self, connection_id: String, is_sender: bool) -> Result<Vec<String>, String> {
        let removed_ids = Vec::new();
        
        // If the new connection is a sender, we should check if one already exists
        // (Usually only 1 sender per room in this simple model)
        if is_sender {
            let sender_exists = self.connections.values().any(|c| c.is_sender);
            if sender_exists {
                // For simplicity, we could allow it, but let's stick to 1 sender
                return Err("Sender already exists in this room".to_string());
            }
        }
        
        let connection_info = ConnectionInfo {
            id: connection_id.clone(),
            is_sender,
            connected_at: chrono::Utc::now(),
        };
        
        self.connections.insert(connection_id, connection_info);
        Ok(removed_ids)
    }
    
    pub fn remove_connection(&mut self, connection_id: &str) {
        self.connections.remove(connection_id);
        // Clean up associated offers
        self.offers.retain(|_, offer| {
            if let Some(sender_id) = offer.sender_id.as_ref() {
                sender_id != connection_id
            } else {
                true
            }
        });
    }
    
    pub fn add_offer(&mut self, offer: SignalingMessage) -> Result<(), String> {
        let offer_id = Uuid::new_v4().to_string();
        let mut offer_with_id = offer;
        offer_with_id.offer_id = Some(offer_id.clone());
        
        self.offers.insert(offer_id, offer_with_id);
        Ok(())
    }
    
    pub fn get_offers_for_viewer(&self) -> Vec<&SignalingMessage> {
        self.offers.values().collect()
    }
    
    pub fn get_connection_count(&self) -> usize {
        self.connections.len()
    }
}

#[derive(Debug)]
pub struct RoomManager {
    pub rooms: HashMap<String, Room>,
    // Simple in-memory inference DB: room_id -> (source_sender_id -> latest inference Value)
    pub inference_db: HashMap<String, HashMap<String, Value>>,
    pub persistence_db: String,
    pub persistence_jsonl: String,
}

impl RoomManager {
    pub fn new(persistence_db: String, persistence_jsonl: String) -> Self {
        Self {
            rooms: HashMap::new(),
            inference_db: HashMap::new(),
            persistence_db,
            persistence_jsonl,
        }
    }
    
    pub fn create_room(&mut self, room_id: String) {
        let room = Room::new(room_id.clone());
        self.rooms.insert(room_id, room);
    }
    
    pub fn handle_message(&mut self, room_id: String, message: SignalingMessage) -> Option<Vec<SignalingMessage>> {
        let room = self.rooms.get_mut(&room_id)?;
        
        match message.message_type {
            SignalingMessageType::Join => {
                let is_sender = message.is_sender.unwrap_or(false);
                let connection_id = message.connection_id.clone()?;
                
                let removed_ids = match room.add_connection(connection_id.clone(), is_sender) {
                    Ok(ids) => ids,
                    Err(e) => {
                        return Some(vec![SignalingMessage {
                            message_type: SignalingMessageType::Error,
                            connection_id: Some(connection_id),
                            source_sender_id: None,
                            sender_id: None,
                            offer_id: None,
                            data: Some(serde_json::json!({
                                "error": e
                            })),
                            is_sender: None,
                        }]);
                    }
                };
                
                let connection_count = room.get_connection_count();

                // Prepare RoomInfo for the joiner
                let mut responses = vec![SignalingMessage {
                    message_type: SignalingMessageType::RoomInfo,
                    connection_id: Some(connection_id.clone()),
                    source_sender_id: None,
                    sender_id: None,
                    offer_id: None,
                    data: Some(serde_json::json!({
                        "room_id": room_id,
                        "mode": "1onN",
                        "connection_count": connection_count,
                        "peers": room.connections.iter()
                                .filter(|(id, _)| *id != &connection_id)
                                .map(|(id, info)| serde_json::json!({ "id": id, "is_sender": info.is_sender }))
                                .collect::<Vec<_>>()
                    })),
                    is_sender: None,
                }];

                // Notify about replaced connections (Leave messages)
                for rid in removed_ids {
                    for (other_id, _) in &room.connections {
                        responses.push(SignalingMessage {
                            message_type: SignalingMessageType::Leave,
                            connection_id: Some(other_id.clone()),
                            source_sender_id: None,
                            sender_id: None,
                            offer_id: None,
                            data: Some(serde_json::json!({
                                "connection_id": rid,
                                "connection_count": connection_count
                            })),
                            is_sender: None,
                        });
                    }
                }

                // Notify other peers about the new user
                for (other_id, _) in &room.connections {
                    if *other_id != connection_id {
                        responses.push(SignalingMessage {
                            message_type: SignalingMessageType::NewPeer,
                            connection_id: Some(other_id.clone()),
                            source_sender_id: None,
                            sender_id: None,
                            offer_id: None,
                            data: Some(serde_json::json!({
                                "connection_id": connection_id,
                                "is_sender": is_sender,
                                "connection_count": connection_count
                            })),
                            is_sender: None,
                        });
                    }
                }

                // Legacy: If this is a viewer, send them existing stored offers
                if !is_sender {
                    let offers = room.get_offers_for_viewer();
                    for offer in offers {
                        responses.push(SignalingMessage {
                            message_type: SignalingMessageType::Offer,
                            connection_id: Some(connection_id.clone()),
                            source_sender_id: None,
                            sender_id: offer.sender_id.clone(),
                            offer_id: offer.offer_id.clone(),
                            data: offer.data.clone(),
                            is_sender: None,
                        });
                    }
                }
                
                Some(responses)
            }
            
            SignalingMessageType::Offer => {
                // In Mesh 1onN, we usually route directly if connection_id is set
                if message.connection_id.is_some() {
                    return Some(vec![message]);
                }

                // Store and broadcast (Legacy/Broadcast Mode support)
                if let Err(e) = room.add_offer(message.clone()) {
                    return Some(vec![SignalingMessage {
                        message_type: SignalingMessageType::Error,
                        connection_id: message.connection_id,
                        source_sender_id: None,
                        sender_id: message.sender_id,
                        offer_id: message.offer_id,
                        data: Some(serde_json::json!({
                            "error": e
                        })),
                        is_sender: None,
                    }]);
                }
                
                let offers = room.get_offers_for_viewer();
                let mut responses = Vec::new();
                
                for offer in offers {
                    for (conn_id, conn_info) in &room.connections {
                        if !conn_info.is_sender {
                            responses.push(SignalingMessage {
                                message_type: SignalingMessageType::Offer,
                                connection_id: Some(conn_id.clone()),
                                source_sender_id: None,
                                sender_id: offer.sender_id.clone(),
                                offer_id: offer.offer_id.clone(),
                                data: offer.data.clone(),
                                is_sender: None,
                            });
                        }
                    }
                }
                
                Some(responses)
            }
            
            SignalingMessageType::Answer => Some(vec![message]),

            SignalingMessageType::IceCandidate => {
                if message.connection_id.is_some() {
                    Some(vec![message])
                } else {
                    let mut responses = Vec::new();
                    for (conn_id, conn_info) in &room.connections {
                        if !conn_info.is_sender {
                            let mut msg = message.clone();
                            msg.connection_id = Some(conn_id.clone());
                            responses.push(msg);
                        }
                    }
                    Some(responses)
                }
            }

            SignalingMessageType::InferenceResult => {
                // Expect message.source_sender_id to indicate which original sender the predictions refer to
                let source_id = message.source_sender_id.clone();
                if source_id.is_none() {
                    return None;
                }
                let source_id = source_id.unwrap();

                // Store the latest data in inference_db (in-memory)
                let room_entry = self.inference_db.entry(room_id.clone()).or_insert_with(HashMap::new);
                if let Some(d) = message.data.clone() {
                    // Update in-memory
                    room_entry.insert(source_id.clone(), d.clone());

                    // Persist: attempt SQLite insert, log error on failure.
                    if let Err(e) = persistence::save_inference_sqlite(&self.persistence_db, &room_id, &source_id, &d) {
                        error!("Failed to save inference to sqlite: {}", e);
                    }
                    if let Err(e) = persistence::append_jsonl(&self.persistence_jsonl, &room_id, &source_id, &d) {
                        error!("Failed to append inference to jsonl: {}", e);
                    }
                }

                // Broadcast a lightweight InferenceUpdate to all peers in the room
                let mut responses = Vec::new();
                if let Some(room) = self.rooms.get(&room_id) {
                    for (conn_id, _) in &room.connections {
                        // Prepare aggregated payload: include latest for this source
                        let payload = serde_json::json!({
                            "source_sender_id": source_id,
                            "latest": room_entry.get(&source_id)
                        });

                        responses.push(SignalingMessage {
                            message_type: SignalingMessageType::InferenceUpdate,
                            connection_id: Some(conn_id.clone()),
                            source_sender_id: None,
                            sender_id: None,
                            offer_id: None,
                            data: Some(payload),
                            is_sender: None,
                        });
                    }
                }

                Some(responses)
            }

            _ => None,
        }
    }
    
    pub fn remove_connection(&mut self, room_id: &str, connection_id: &str) -> Option<Vec<SignalingMessage>> {
        let room = self.rooms.get_mut(room_id)?;
        room.remove_connection(connection_id);
        
        let connection_count = room.get_connection_count();
        let mut responses = Vec::new();
        
        for (other_id, _) in &room.connections {
            responses.push(SignalingMessage {
                message_type: SignalingMessageType::Leave,
                connection_id: Some(other_id.clone()),
                source_sender_id: None,
                sender_id: None,
                offer_id: None,
                data: Some(serde_json::json!({
                    "connection_id": connection_id,
                    "connection_count": connection_count
                })),
                is_sender: None,
            });
        }
        
        Some(responses)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_room_creation() {
        let mut manager = RoomManager::new("test.db".to_string(), "test.jsonl".to_string());
        manager.create_room("test-room".to_string());
        assert!(manager.rooms.contains_key("test-room"));
        assert_eq!(manager.rooms.get("test-room").unwrap().get_connection_count(), 0);
    }

    #[test]
    fn test_add_connection() {
        let mut room = Room::new("test".to_string());
        
        // Add sender
        let res = room.add_connection("sender1".to_string(), true);
        assert!(res.is_ok());
        assert_eq!(room.get_connection_count(), 1);

        // Try to add another sender (should fail)
        let res = room.add_connection("sender2".to_string(), true);
        assert!(res.is_err());
        assert_eq!(room.get_connection_count(), 1);

        // Add viewer
        let res = room.add_connection("viewer1".to_string(), false);
        assert!(res.is_ok());
        assert_eq!(room.get_connection_count(), 2);
    }

    #[test]
    fn test_remove_connection() {
        let mut room = Room::new("test".to_string());
        room.add_connection("c1".to_string(), true).unwrap();
        room.add_connection("c2".to_string(), false).unwrap();
        
        room.remove_connection("c1");
        assert_eq!(room.get_connection_count(), 1);
        assert!(room.connections.contains_key("c2"));
    }

    #[test]
    fn test_handle_join_message() {
        let mut manager = RoomManager::new("test.db".to_string(), "test.jsonl".to_string());
        manager.create_room("r1".to_string());
        
        let msg = SignalingMessage {
            message_type: SignalingMessageType::Join,
            connection_id: Some("c1".to_string()),
            source_sender_id: None,
            sender_id: None,
            offer_id: None,
            data: None,
            is_sender: Some(true),
        };
        
        let responses = manager.handle_message("r1".to_string(), msg).unwrap();
        
        // Should have RoomInfo response
        assert_eq!(responses.len(), 1);
        assert_eq!(responses[0].message_type, SignalingMessageType::RoomInfo);
        
        // Verify connection exists
        assert_eq!(manager.rooms.get("r1").unwrap().get_connection_count(), 1);
    }

    #[test]
    fn test_handle_offer_routing() {
        let mut manager = RoomManager::new("test.db".to_string(), "test.jsonl".to_string());
        manager.create_room("r1".to_string());
        
        let msg = SignalingMessage {
            message_type: SignalingMessageType::Offer,
            connection_id: Some("target-viewer".to_string()),
            source_sender_id: None,
            sender_id: Some("sender1".to_string()),
            offer_id: None,
            data: Some(serde_json::json!({"sdp": "test"})),
            is_sender: Some(true),
        };
        
        // Routing should just pass the message back through if connection_id is set
        let responses = manager.handle_message("r1".to_string(), msg.clone()).unwrap();
        assert_eq!(responses.len(), 1);
        assert_eq!(responses[0].connection_id, Some("target-viewer".to_string()));
    }

    #[test]
    fn test_handle_inference_result() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("test.db").to_str().unwrap().to_string();
        let jsonl_path = temp_dir.path().join("test.jsonl").to_str().unwrap().to_string();
        
        let mut manager = RoomManager::new(db_path, jsonl_path);
        manager.create_room("r1".to_string());
        
        // Add a viewer to receive updates
        manager.rooms.get_mut("r1").unwrap().add_connection("viewer1".to_string(), false).unwrap();
        
        let msg = SignalingMessage {
            message_type: SignalingMessageType::InferenceResult,
            connection_id: None,
            source_sender_id: Some("sender1".to_string()),
            sender_id: None,
            offer_id: None,
            data: Some(serde_json::json!({"predictions": []})),
            is_sender: None,
        };
        
        // Should trigger broadcast as InferenceUpdate
        let responses = manager.handle_message("r1".to_string(), msg).unwrap();
        
        // One update for each connection (we have 1 viewer)
        assert!(responses.iter().any(|m| m.message_type == SignalingMessageType::InferenceUpdate));
        assert!(responses.iter().any(|m| m.connection_id == Some("viewer1".to_string())));
        
        // Check in-memory DB update
        assert!(manager.inference_db.contains_key("r1"));
        assert_eq!(manager.inference_db.get("r1").unwrap().get("sender1").unwrap()["predictions"], serde_json::json!([]));
    }
}

