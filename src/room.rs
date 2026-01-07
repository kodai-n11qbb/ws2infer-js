use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use crate::signaling::{SignalingMessage, SignalingMessageType};

#[derive(Debug, Clone)]
pub struct Room {
    pub id: String,
    pub mode: RoomMode,
    pub connections: HashMap<String, ConnectionInfo>,
    pub offers: HashMap<String, SignalingMessage>,
}

#[derive(Debug, Clone)]
pub struct ConnectionInfo {
    pub id: String,
    pub is_sender: bool,
    pub connected_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum RoomMode {
    OneOnOne,
    OneOnN,
}

impl Room {
    pub fn new(id: String, mode: RoomMode) -> Self {
        Self {
            id,
            mode,
            connections: HashMap::new(),
            offers: HashMap::new(),
        }
    }
    
    pub fn add_connection(&mut self, connection_id: String, is_sender: bool) -> Result<(), String> {
        if self.mode == RoomMode::OneOnOne {
            // For 1on1 mode, only allow 2 connections (1 sender, 1 viewer)
            let sender_count = self.connections.values().filter(|c| c.is_sender).count();
            let viewer_count = self.connections.values().filter(|c| !c.is_sender).count();
            
            if is_sender && sender_count >= 1 {
                return Err("Sender already exists in 1on1 room".to_string());
            }
            if !is_sender && viewer_count >= 1 {
                return Err("Viewer already exists in 1on1 room".to_string());
            }
        }
        
        let connection_info = ConnectionInfo {
            id: connection_id.clone(),
            is_sender,
            connected_at: chrono::Utc::now(),
        };
        
        self.connections.insert(connection_id, connection_info);
        Ok(())
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
        if self.mode == RoomMode::OneOnOne {
            // In 1on1 mode, replace existing offer
            self.offers.clear();
        }
        
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
    rooms: HashMap<String, Room>,
}

impl RoomManager {
    pub fn new() -> Self {
        Self {
            rooms: HashMap::new(),
        }
    }
    
    pub fn create_one_on_one_room(&mut self, room_id: String) {
        let room = Room::new(room_id.clone(), RoomMode::OneOnOne);
        self.rooms.insert(room_id, room);
    }
    
    pub fn create_one_on_n_room(&mut self, room_id: String) {
        let room = Room::new(room_id.clone(), RoomMode::OneOnN);
        self.rooms.insert(room_id, room);
    }
    
    pub fn handle_message(&mut self, room_id: String, message: SignalingMessage) -> Option<Vec<SignalingMessage>> {
        let room = self.rooms.get_mut(&room_id)?;
        
        match message.message_type {
            SignalingMessageType::Join => {
                let is_sender = message.is_sender.unwrap_or(false);
                let connection_id = message.connection_id.clone()?;
                
                if let Err(e) = room.add_connection(connection_id.clone(), is_sender) {
                    return Some(vec![SignalingMessage {
                        message_type: SignalingMessageType::Error,
                        connection_id: Some(connection_id),
                        sender_id: None,
                        offer_id: None,
                        data: Some(serde_json::json!({
                            "error": e
                        })),
                        is_sender: None,
                    }]);
                }
                
                // Send room info
                Some(vec![SignalingMessage {
                    message_type: SignalingMessageType::RoomInfo,
                    connection_id: Some(connection_id),
                    sender_id: None,
                    offer_id: None,
                    data: Some(serde_json::json!({
                        "room_id": room_id,
                        "mode": match room.mode {
                            RoomMode::OneOnOne => "1on1",
                            RoomMode::OneOnN => "1onN",
                        },
                        "connection_count": room.get_connection_count()
                    })),
                    is_sender: None,
                }])
            }
            
            SignalingMessageType::Offer => {
                if let Err(e) = room.add_offer(message.clone()) {
                    return Some(vec![SignalingMessage {
                        message_type: SignalingMessageType::Error,
                        connection_id: message.connection_id,
                        sender_id: message.sender_id,
                        offer_id: message.offer_id,
                        data: Some(serde_json::json!({
                            "error": e
                        })),
                        is_sender: None,
                    }]);
                }
                
                // Broadcast offer to viewers
                let offers = room.get_offers_for_viewer();
                let mut responses = Vec::new();
                
                for offer in offers {
                    for (conn_id, conn_info) in &room.connections {
                        if !conn_info.is_sender {
                            responses.push(SignalingMessage {
                                message_type: SignalingMessageType::Offer,
                                connection_id: Some(conn_id.clone()),
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
            
            SignalingMessageType::Answer | SignalingMessageType::IceCandidate => {
                // Relay messages to target connection
                Some(vec![message])
            }
            
            _ => None,
        }
    }
    
    pub fn remove_connection(&mut self, room_id: &str) {
        if let Some(room) = self.rooms.get_mut(room_id) {
            // Remove all connections (simplified - in real implementation, track specific connection)
            room.connections.clear();
        }
    }
}
