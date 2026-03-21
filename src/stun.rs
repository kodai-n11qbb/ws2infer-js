use std::net::SocketAddr;
use std::collections::HashMap;
use log::{info, error, debug};
use byteorder::{BigEndian, ByteOrder};
use tokio::net::UdpSocket;
use std::sync::Arc;

// STUN message types
const BINDING_REQUEST: u16 = 0x0001;
const BINDING_RESPONSE: u16 = 0x0101;
const BINDING_ERROR_RESPONSE: u16 = 0x0111;

// STUN attribute types
#[allow(dead_code)]
const MAPPED_ADDRESS: u16 = 0x0001;
const XOR_MAPPED_ADDRESS: u16 = 0x0020;
const ERROR_CODE: u16 = 0x0009;

pub struct StunServer {
    socket: Arc<UdpSocket>,
    #[allow(dead_code)]
    local_addrs: HashMap<SocketAddr, SocketAddr>,
}

impl StunServer {
    pub fn new(bind_addr: SocketAddr) -> std::io::Result<Self> {
        let socket = std::net::UdpSocket::bind(bind_addr)?;
        socket.set_nonblocking(true)?;
        let tokio_socket = UdpSocket::from_std(socket)?;
        info!("STUN server listening on {}", bind_addr);
        
        Ok(Self {
            socket: Arc::new(tokio_socket),
            local_addrs: HashMap::new(),
        })
    }
    
    pub async fn run(&mut self) -> std::io::Result<()> {
        let mut buf = [0u8; 1024];
        
        loop {
            match self.socket.recv_from(&mut buf).await {
                Ok((len, src_addr)) => {
                    let packet = &buf[..len];
                    
                    if let Some(response) = self.handle_stun_packet(packet, src_addr) {
                        if let Err(e) = self.socket.send_to(&response, src_addr).await {
                            error!("Failed to send STUN response: {}", e);
                        }
                    }
                }
                Err(e) => {
                    error!("STUN server error: {}", e);
                }
            }
        }
    }
    
    fn handle_stun_packet(&mut self, packet: &[u8], src_addr: SocketAddr) -> Option<Vec<u8>> {
        if packet.len() < 20 {
            debug!("Packet too short for STUN message");
            return None;
        }
        
        let msg_type = BigEndian::read_u16(&packet[0..2]);
        let msg_len = BigEndian::read_u16(&packet[2..4]);
        
        // Verify packet length
        if packet.len() != 20 + msg_len as usize {
            debug!("STUN packet length mismatch");
            return None;
        }
        
        match msg_type {
            BINDING_REQUEST => {
                debug!("STUN binding request from {}", src_addr);
                Some(self.create_binding_response(packet, src_addr))
            }
            _ => {
                debug!("Unsupported STUN message type: 0x{:04x}", msg_type);
                Some(self.create_error_response(packet, 400, "Bad Request"))
            }
        }
    }
    
    fn create_binding_response(&self, request: &[u8], src_addr: SocketAddr) -> Vec<u8> {
        let mut response = Vec::new();
        
        // Message header
        response.extend_from_slice(&BINDING_RESPONSE.to_be_bytes());
        response.extend_from_slice(&0u16.to_be_bytes()); // Length (placeholder)
        response.extend_from_slice(&request[4..20]); // Copy magic cookie and transaction ID
        
        // XOR-MAPPED-ADDRESS attribute
        let attr_type = XOR_MAPPED_ADDRESS;
        let attr_len = 8u16;
        
        response.extend_from_slice(&attr_type.to_be_bytes());
        response.extend_from_slice(&attr_len.to_be_bytes());
        response.push(0x00); // Reserved
        response.push(0x01); // IPv4 family
        
        let ip = src_addr.ip();
        let port = src_addr.port() ^ 0x2112; // XOR with magic cookie
        
        response.extend_from_slice(&port.to_be_bytes());
        
        match ip {
            std::net::IpAddr::V4(ipv4) => {
                let octets = ipv4.octets();
                for octet in octets {
                    response.push(octet ^ 0x21); // XOR with magic cookie bytes
                }
            }
            std::net::IpAddr::V6(_) => {
                // IPv6 support would go here
                response.extend_from_slice(&[0; 16]);
            }
        }
        
        // Update message length
        let total_len = response.len() - 20;
        response[2..4].copy_from_slice(&(total_len as u16).to_be_bytes());
        
        response
    }
    
    fn create_error_response(&self, request: &[u8], code: u16, reason: &str) -> Vec<u8> {
        let mut response = Vec::new();
        
        // Message header
        response.extend_from_slice(&BINDING_ERROR_RESPONSE.to_be_bytes());
        response.extend_from_slice(&0u16.to_be_bytes()); // Length (placeholder)
        response.extend_from_slice(&request[4..20]); // Copy magic cookie and transaction ID
        
        // ERROR-CODE attribute
        let error_class = code / 100;
        let _error_number = code % 100;
        let reason_bytes = reason.as_bytes();
        let attr_len = 4 + reason_bytes.len() as u16;
        
        response.extend_from_slice(&ERROR_CODE.to_be_bytes());
        response.extend_from_slice(&attr_len.to_be_bytes());
        response.extend_from_slice(&0u16.to_be_bytes());
        response.push((error_class / 100) as u8);
        response.push((error_class % 100) as u8);
        response.extend_from_slice(reason_bytes);
        
        // Update message length
        let total_len = response.len() - 20;
        response[2..4].copy_from_slice(&(total_len as u16).to_be_bytes());
        
        response
    }
    
    pub fn get_local_address(&self) -> std::io::Result<SocketAddr> {
        self.socket.local_addr()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_handle_stun_packet_binding_request() {
        // Mock STUN server (not actually bound to a real port for message handling tests)
        let addr = "127.0.0.1:0".parse().unwrap();
        let mut server = StunServer::new(addr).unwrap();
        
        // Construct a dummy STUN Binding Request (20 bytes header, no attributes)
        let mut packet = vec![0u8; 20];
        BigEndian::write_u16(&mut packet[0..2], BINDING_REQUEST);
        BigEndian::write_u16(&mut packet[2..4], 0); // length
        // Magic cookie / Transaction ID
        packet[4..20].copy_from_slice(&[0x21, 0x12, 0xA4, 0x42, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

        let src_addr: SocketAddr = "192.168.1.1:12345".parse().unwrap();
        let response = server.handle_stun_packet(&packet, src_addr);
        
        assert!(response.is_some());
        let res_bytes = response.unwrap();
        assert_eq!(BigEndian::read_u16(&res_bytes[0..2]), BINDING_RESPONSE);
    }
}
