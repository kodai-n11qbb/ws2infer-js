use std::collections::HashMap;
use uuid::Uuid;
use serde_json::Value;
use crate::signaling::SignalingMessage;
use log::error;

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
            if let SignalingMessage::Offer { sender_id, .. } = offer {
                sender_id != connection_id
            } else {
                true
            }
        });
    }
    
    pub fn add_offer(&mut self, mut offer: SignalingMessage) -> Result<(), String> {
        let offer_id_val = Uuid::new_v4().to_string();
        if let SignalingMessage::Offer { offer_id: ref mut oid, .. } = offer {
            *oid = Some(offer_id_val.clone());
        }
        
        self.offers.insert(offer_id_val, offer);
        Ok(())
    }
    
    pub fn get_offers_for_viewer(&self) -> Vec<&SignalingMessage> {
        self.offers.values().collect()
    }
    
    pub fn get_connection_count(&self) -> usize {
        self.connections.len()
    }
}

use crate::persistence::InferenceStorage;
pub struct RoomManager<S: InferenceStorage> {
    pub rooms: HashMap<String, Room>,
    // Simple in-memory inference DB: room_id -> (source_sender_id -> latest inference Value)
    pub inference_db: HashMap<String, HashMap<String, Value>>,
    pub storage: S,
}

impl<S: InferenceStorage> RoomManager<S> {
    pub fn new(storage: S) -> Self {
        Self {
            rooms: HashMap::new(),
            inference_db: HashMap::new(),
            storage,
        }
    }
    
    pub fn create_room(&mut self, room_id: String) {
        let room = Room::new(room_id.clone());
        self.rooms.insert(room_id, room);
    }
    
    pub fn handle_message(&mut self, room_id: String, message: SignalingMessage) -> Option<Vec<SignalingMessage>> {
        let room = self.rooms.get_mut(&room_id)?;
        
        match message {
            SignalingMessage::Join { connection_id, is_sender } => {
                let removed_ids = match room.add_connection(connection_id.clone(), is_sender) {
                    Ok(ids) => ids,
                    Err(e) => {
                        return Some(vec![SignalingMessage::Error {
                            connection_id,
                            data: serde_json::json!({ "error": e }),
                        }]);
                    }
                };
                
                let connection_count = room.get_connection_count();

                // Prepare RoomInfo for the joiner
                let mut responses = vec![SignalingMessage::RoomInfo {
                    connection_id: connection_id.clone(),
                    data: serde_json::json!({
                        "room_id": room_id,
                        "mode": "1onN",
                        "connection_count": connection_count,
                        "peers": room.connections.iter()
                                .filter(|(id, _)| *id != &connection_id)
                                .map(|(id, info)| serde_json::json!({ "id": id, "is_sender": info.is_sender }))
                                .collect::<Vec<_>>()
                    }),
                }];

                // Notify about replaced connections (Leave messages)
                for _rid in removed_ids {
                    for (other_id, _) in &room.connections {
                        responses.push(SignalingMessage::Leave {
                            connection_id: other_id.clone(),
                            data: serde_json::json!({
                                "connection_id": other_id.clone(),
                                "connection_count": connection_count,
                            }),
                        });
                    }
                }

                // Notify other peers about the new user
                for (other_id, _) in &room.connections {
                    if *other_id != connection_id {
                        responses.push(SignalingMessage::NewPeer {
                            connection_id: other_id.clone(),
                            data: serde_json::json!({
                                "connection_id": connection_id.clone(),
                                "is_sender": is_sender,
                                "connection_count": connection_count,
                            }),
                        });
                    }
                }

                // Legacy: If this is a viewer, send them existing stored offers
                if !is_sender {
                    let offers = room.get_offers_for_viewer();
                    for offer in offers {
                        responses.push(offer.clone());
                    }
                }
                
                Some(responses)
            }
            
            SignalingMessage::Offer { connection_id, sender_id, offer_id, data } => {
                // In Mesh 1onN, we usually route directly if connection_id is set
                if connection_id.is_some() {
                    return Some(vec![SignalingMessage::Offer { connection_id, sender_id, offer_id, data }]);
                }

                // Store and broadcast (Legacy/Broadcast Mode support)
                let message_to_store = SignalingMessage::Offer { connection_id, sender_id: sender_id.clone(), offer_id: offer_id.clone(), data: data.clone() };
                if let Err(e) = room.add_offer(message_to_store) {
                    return Some(vec![SignalingMessage::Error {
                        connection_id: sender_id,
                        data: serde_json::json!({ "error": e }),
                    }]);
                }
                
                let offers = room.get_offers_for_viewer();
                let mut responses = Vec::new();
                
                for offer in offers {
                    for (conn_id, conn_info) in &room.connections {
                        if !conn_info.is_sender {
                            if let SignalingMessage::Offer { sender_id, offer_id, data, .. } = offer {
                                responses.push(SignalingMessage::Offer {
                                    connection_id: Some(conn_id.clone()),
                                    sender_id: sender_id.clone(),
                                    offer_id: offer_id.clone(),
                                    data: data.clone(),
                                });
                            }
                        }
                    }
                }
                
                Some(responses)
            }
            
            SignalingMessage::Answer { connection_id, sender_id, data } => 
                Some(vec![SignalingMessage::Answer { connection_id, sender_id, data }]),

            SignalingMessage::IceCandidate { connection_id, sender_id, data } => {
                if connection_id.is_some() {
                    Some(vec![SignalingMessage::IceCandidate { connection_id, sender_id, data }])
                } else {
                    let mut responses = Vec::new();
                    for (conn_id, conn_info) in &room.connections {
                        if !conn_info.is_sender {
                            responses.push(SignalingMessage::IceCandidate {
                                connection_id: Some(conn_id.clone()),
                                sender_id: sender_id.clone(),
                                data: data.clone(),
                            });
                        }
                    }
                    Some(responses)
                }
            }

            SignalingMessage::InferenceResult { source_sender_id, data } => {
                // Store the latest data in inference_db (in-memory)
                let room_entry = self.inference_db.entry(room_id.clone()).or_insert_with(HashMap::new);
                if let Some(d) = data.clone() {
                    // Update in-memory
                    room_entry.insert(source_sender_id.clone(), d.clone());

                    // Persist: use injected storage trait (DI)
                    if let Err(e) = self.storage.save_inference(&room_id, &source_sender_id, &d) {
                        error!("Failed to save inference: {}", e);
                    }
                }

                // Broadcast a lightweight InferenceUpdate to all peers in the room
                let mut responses = Vec::new();
                if let Some(room) = self.rooms.get(&room_id) {
                    for (conn_id, _) in &room.connections {
                        // Prepare aggregated payload: include latest for this source
                        let payload = serde_json::json!({
                            "source_sender_id": source_sender_id,
                            "latest": room_entry.get(&source_sender_id)
                        });

                        responses.push(SignalingMessage::InferenceUpdate {
                            connection_id: conn_id.clone(),
                            data: payload,
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
            responses.push(SignalingMessage::Leave {
                connection_id: other_id.clone(),
                data: serde_json::json!({
                    "connection_id": connection_id.clone(),
                    "connection_count": connection_count
                }),
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
        let storage = crate::persistence::MockStorage;
        let mut manager = RoomManager::new(storage);
        manager.create_room("test-room".to_string());
        assert!(manager.rooms.contains_key("test-room"));
        assert_eq!(manager.rooms.get("test-room").unwrap().get_connection_count(), 0);
    }

    #[test]
    fn test_add_connection() {
        let storage = crate::persistence::MockStorage;
        let mut manager = RoomManager::new(storage);
        manager.create_room("r1".to_string());
        
        manager.rooms.get_mut("r1").unwrap().add_connection("c1".to_string(), true).unwrap();
        assert_eq!(manager.rooms.get("r1").unwrap().get_connection_count(), 1);
        
        // Block multiple senders
        let res = manager.rooms.get_mut("r1").unwrap().add_connection("c2".to_string(), true);
        assert!(res.is_err());
    }

    #[test]
    fn test_handle_join_message() {
        let storage = crate::persistence::MockStorage;
        let mut manager = RoomManager::new(storage);
        manager.create_room("r1".to_string());
        
        let msg = SignalingMessage::Join {
            connection_id: "c1".to_string(),
            is_sender: true,
        };
        
        let responses = manager.handle_message("r1".to_string(), msg).unwrap();
        
        // Should have RoomInfo response
        assert_eq!(responses.len(), 1);
        if let SignalingMessage::RoomInfo { .. } = responses[0] {
            // ok
        } else {
            panic!("Expected RoomInfo");
        }
        
        // Verify connection exists
        assert_eq!(manager.rooms.get("r1").unwrap().get_connection_count(), 1);
        assert_eq!(manager.rooms.get("r1").unwrap().id, "r1");
    }
}

