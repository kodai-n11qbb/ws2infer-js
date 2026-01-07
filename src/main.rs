use log::info;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{RwLock, broadcast};
use warp::{Filter, Reply};
use warp::ws::{WebSocket, Message};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

mod room;
mod stun;
mod turn;
mod signaling;

use room::{Room, RoomManager};
use signaling::{SignalingMessage, SignalingServer};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RoomMode {
    OneOnOne,
    OneOnN,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRoomRequest {
    mode: RoomMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoomResponse {
    room_id: String,
    mode: RoomMode,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    env_logger::init();
    
    info!("Starting Cam2WebRTC Signaling Server...");
    
    // Initialize room manager
    let room_manager = Arc::new(RwLock::new(RoomManager::new()));
    
    // Clone for WebSocket handler
    let room_manager_ws = room_manager.clone();
    
    // WebSocket route
    let ws_route = warp::path("ws")
        .and(warp::path::param::<String>())
        .and(warp::ws())
        .and(warp::any().map(move || room_manager_ws.clone()))
        .and_then(|room_id: String, ws: warp::ws::Ws, room_manager: Arc<RwLock<RoomManager>>| async move {
            Ok::<_, warp::Rejection>(ws.on_upgrade(move |socket| handle_websocket(socket, room_id, room_manager)))
        });
    
    // REST API routes
    let room_manager_api = room_manager.clone();
    let api_routes = warp::path("api")
        .and(warp::path("rooms"))
        .and(warp::post())
        .and(warp::body::json())
        .and(warp::any().map(move || room_manager_api.clone()))
        .and_then(|req: CreateRoomRequest, room_manager: Arc<RwLock<RoomManager>>| async move {
            let room_id = Uuid::new_v4().to_string();
            let mut manager = room_manager.write().await;
            
            match req.mode {
                RoomMode::OneOnOne => manager.create_one_on_one_room(room_id.clone()),
                RoomMode::OneOnN => manager.create_one_on_n_room(room_id.clone()),
            }
            
            let response = RoomResponse {
                room_id,
                mode: req.mode,
            };
            
            Ok::<_, warp::Rejection>(warp::reply::json(&response))
        });
    
    // Static file serving for HTML clients
    let static_files = warp::fs::dir("static");
    
    // Combine all routes
    let routes = ws_route
        .or(api_routes)
        .or(static_files)
        .with(warp::cors().allow_any_origin().allow_methods(vec!["GET", "POST"]));
    
    info!("Server listening on 0.0.0.0:8080");
    
    // Start server
    warp::serve(routes)
        .run(([0, 0, 0, 0], 8080))
        .await;
    
    Ok(())
}

async fn handle_websocket(
    socket: WebSocket,
    room_id: String,
    room_manager: Arc<RwLock<RoomManager>>,
) {
    info!("New WebSocket connection for room: {}", room_id);
    
    let (mut tx, mut rx) = socket.split();
    let room_manager_clone = room_manager.clone();
    
    // Handle incoming messages
    while let Some(result) = rx.next().await {
        match result {
            Ok(msg) => {
                if let Ok(text) = msg.to_str() {
                    if let Ok(signaling_msg) = serde_json::from_str::<SignalingMessage>(text) {
                        let mut manager: tokio::sync::RwLockWriteGuard<'_, RoomManager> = room_manager_clone.write().await;
                        if let Some(responses) = manager.handle_message(room_id.clone(), signaling_msg) {
                            for response in responses {
                                if let Ok(response_text) = serde_json::to_string(&response) {
                                    let _: Result<(), warp::Error> = tx.send(Message::text(response_text)).await;
                                }
                            }
                        }
                    }
                }
            }
            Err(e) => {
                info!("WebSocket error: {}", e);
                break;
            }
        }
    }
    
    // Clean up connection
    let mut manager: tokio::sync::RwLockWriteGuard<'_, RoomManager> = room_manager_clone.write().await;
    manager.remove_connection(&room_id);
    info!("WebSocket connection closed for room: {}", room_id);
}
