use std::net::IpAddr;

pub fn local_network_ip() -> Option<IpAddr> {
    local_ip_address::local_ip().ok()
}
