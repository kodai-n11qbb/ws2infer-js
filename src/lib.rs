pub mod room;
pub mod signaling;
pub mod persistence;
pub mod stun;
pub mod turn;
pub mod config;
pub mod network;

use std::sync::Arc;
use tokio::sync::{RwLock, mpsc};
use warp::Filter;
use warp::ws::Message;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use log::{info, error};
use std::net::SocketAddr;
use std::fs;
use rcgen::generate_simple_self_signed;

use crate::room::RoomManager;
use crate::stun::StunServer;
use crate::turn::TurnServer;
use crate::config::Config;
use crate::network::get_all_local_ips;

pub type Clients = Arc<RwLock<HashMap<String, mpsc::UnboundedSender<Message>>>>;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRoomRequest {
    pub room_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoomResponse {
    pub room_id: String,
}

pub async fn run_server(config: Config) -> anyhow::Result<()> {
    let config_arc = Arc::new(config);
    
    // Ensure data directory exists
    if let Err(e) = std::fs::create_dir_all("data") {
        error!("Failed to create data directory: {}", e);
    }

    if let Err(e) = persistence::init_db("data/inference.db") {
        error!("Failed to initialize inference DB: {}", e);
    }

    // Start STUN server
    let stun_config = config_arc.clone();
    tokio::task::spawn(async move {
        let stun_addr: SocketAddr = stun_config.stun_addr.parse().expect("Invalid STUN address");
        match StunServer::new(stun_addr) {
            Ok(mut server) => {
                info!("Starting STUN server on {}", stun_addr);
                let _ = server.run().await;
            }
            Err(e) => error!("Failed to create STUN server: {}", e),
        }
    });

    // Start TURN server
    let turn_config = config_arc.clone();
    tokio::task::spawn(async move {
        let turn_addr: SocketAddr = turn_config.turn_addr.parse().expect("Invalid TURN address");
        match TurnServer::new(turn_addr) {
            Ok(mut server) => {
                info!("Starting TURN server on {}", turn_addr);
                let _ = server.run().await;
            }
            Err(e) => error!("Failed to create TURN server: {}", e),
        }
    });
    
    let storage = Arc::new(persistence::FileStorage::new(
        "data/inference.db".to_string(),
        "data/inference.jsonl".to_string()
    )?);
    
    let room_manager = Arc::new(RwLock::new(RoomManager::new(storage)));
    let clients = Clients::default();
    
    let room_manager_ws = room_manager.clone();
    let clients_ws = clients.clone();
    let signaling_server = Arc::new(signaling::SignalingServer::new(room_manager_ws, clients_ws));
    
    let ws_route = warp::path("ws")
        .and(warp::path::param::<String>())
        .and(warp::ws())
        .and(warp::any().map(move || signaling_server.clone()))
        .and_then(|room_id: String, ws: warp::ws::Ws, server: Arc<signaling::SignalingServer>| async move {
            Ok::<_, warp::Rejection>(ws.on_upgrade(move |socket| async move {
                server.handle_connection(socket, room_id).await;
            }))
        });
    
    let room_manager_api = room_manager.clone();
    let room_manager_get = room_manager.clone();
    
    let rooms_base = warp::path("api").and(warp::path("rooms"));

    let create_room_route = rooms_base
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .and(warp::any().map(move || room_manager_api.clone()))
        .and_then(|req: CreateRoomRequest, room_manager: Arc<RwLock<RoomManager>>| async move {
            let room_id = req.room_id.unwrap_or_else(|| Uuid::new_v4().to_string());
            let mut manager = room_manager.write().await;
            manager.create_room(room_id.clone());
            Ok::<_, warp::Rejection>(warp::reply::json(&RoomResponse { room_id }))
        });

    let get_room_route = rooms_base
        .and(warp::path::param::<String>())
        .and(warp::get())
        .and(warp::any().map(move || room_manager_get.clone()))
        .and_then(|room_id: String, room_manager: Arc<RwLock<RoomManager>>| async move {
            let manager = room_manager.read().await;
            if manager.rooms.contains_key(&room_id) {
                 Ok::<_, warp::Rejection>(warp::reply::json(&serde_json::json!({"exists": true})))
            } else {
                Err(warp::reject::not_found())
            }
        });
    
    let config_api = config_arc.clone();
    let config_route = warp::path("api")
        .and(warp::path("config"))
        .and(warp::get())
        .map(move || {
            let mut config_response = config_api.as_ref().clone();
            if let Some(local_ip) = network::get_local_ip() {
                let local_ip_str = local_ip.to_string();
                for ice_server in &mut config_response.ice_servers {
                    ice_server.urls = ice_server.urls.iter().map(|url| {
                        url.replace("localhost", &local_ip_str).replace("127.0.0.1", &local_ip_str)
                    }).collect();
                }
            }
            warp::reply::json(&config_response)
        });

    let api_routes = create_room_route.or(get_room_route).or(config_route);
    let static_files = warp::fs::dir("static");
    let routes = ws_route.or(api_routes).or(static_files)
        .with(warp::cors().allow_any_origin().allow_methods(vec!["GET", "POST"]));
    
    let addr: SocketAddr = config_arc.signaling_addr.parse().expect("Invalid signaling address");
    
    if config_arc.tls_enabled {
        if !std::path::Path::new(&config_arc.tls_cert_path).exists() || !std::path::Path::new(&config_arc.tls_key_path).exists() {
            let subject_alt_names = get_all_local_ips();
            let cert = generate_simple_self_signed(subject_alt_names)?;
            fs::write(&config_arc.tls_cert_path, cert.serialize_pem()?)?;
            fs::write(&config_arc.tls_key_path, cert.serialize_private_key_pem())?;
        }
        info!("Server listening on https://{}", addr);
        warp::serve(routes).tls().cert_path(&config_arc.tls_cert_path).key_path(&config_arc.tls_key_path).run(addr).await;
    } else {
        info!("Server listening on http://{}", addr);
        warp::serve(routes).run(addr).await;
    }
    
    Ok(())
}
