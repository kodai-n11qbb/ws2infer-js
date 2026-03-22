// static/js/base.js
export class Cam2WebRTCBase {
    constructor(dependencies = {}) {
        this.document = dependencies.document || (typeof document !== 'undefined' ? document : null);
        this.fetch = dependencies.fetch || (typeof fetch !== 'undefined' ? fetch.bind(window) : null);
        this.WebSocket = dependencies.WebSocket || (typeof WebSocket !== 'undefined' ? WebSocket : null);
        this.RTCPeerConnection = dependencies.RTCPeerConnection || (typeof RTCPeerConnection !== 'undefined' ? RTCPeerConnection : null);
        this.RTCIceCandidate = dependencies.RTCIceCandidate || (typeof RTCIceCandidate !== 'undefined' ? RTCIceCandidate : null);
        this.RTCSessionDescription = dependencies.RTCSessionDescription || (typeof RTCSessionDescription !== 'undefined' ? RTCSessionDescription : null);

        this.statusDiv = this.document ? this.document.getElementById('status') : null;
        this.config = null;
        this.ws = null;
        this.peerConnections = new Map();
    }

    async loadConfig() {
        if (this.config) return this.config;
        if (!this.fetch) return { ice_servers: [{ urls: 'stun:localhost:3478' }] };
        
        try {
            const response = await this.fetch('/api/config');
            if (response.ok) {
                this.config = await response.json();
                console.log('[BASE] Config loaded:', this.config);
                return this.config;
            }
            throw new Error(`Failed to fetch config: ${response.status}`);
        } catch (e) {
            console.error('[BASE] Config load error:', e);
            // Fallback defaults
            this.config = {
                ice_servers: [{ urls: 'stun:localhost:3478' }],
                video_constraints: { width: { ideal: 1280 }, height: { ideal: 720 } }
            };
        }
        return this.config;
    }

    generateConnectionId(prefix) {
        return prefix + '_' + Math.random().toString(36).substr(2, 9);
    }

    updateStatus(message, type) {
        if (!this.statusDiv) {
            console.log(`[${type.toUpperCase()}] ${message}`);
            return;
        }
        this.statusDiv.textContent = message;
        this.statusDiv.className = `status ${type}`;
        console.log(`[${type.toUpperCase()}] ${message}`);
    }

    async handleIceCandidate(message) {
        const peerId = message.sender_id;
        const pc = this.peerConnections.get(peerId);
        if (pc && this.RTCIceCandidate) {
            try {
                await pc.addIceCandidate(new this.RTCIceCandidate(message.data));
            } catch (e) {
                console.error("Error adding ICE candidate", e);
            }
        }
    }
}
