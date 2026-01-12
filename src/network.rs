use std::net::{IpAddr, UdpSocket};

/// Get the local IP address of this machine
pub fn get_local_ip() -> Option<IpAddr> {
    // Try to connect to a public DNS server to determine our local IP
    // This doesn't actually send any data
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let addr = socket.local_addr().ok()?;
    Some(addr.ip())
}

/// Get all local IP addresses (including localhost)
pub fn get_all_local_ips() -> Vec<String> {
    let mut ips = vec!["localhost".to_string(), "127.0.0.1".to_string()];
    
    if let Some(local_ip) = get_local_ip() {
        ips.push(local_ip.to_string());
    }
    
    ips
}
