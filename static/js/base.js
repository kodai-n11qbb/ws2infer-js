// static/js/base.js
export class Cam2WebRTCBase {
    constructor() {
        this.statusDiv = document.getElementById('status');
        this.config = null;
        this.ws = null;
        this.peerConnections = new Map();
    }

    async loadConfig() {
        try {
            const response = await fetch('/api/config');
            if (response.ok) {
                this.config = await response.json();
                console.log('Config loaded:', this.config);
                return this.config;
            }
        } catch (e) {
            console.error('Failed to load config:', e);
        }
        return null;
    }

    generateConnectionId(prefix) {
        return prefix + '_' + Math.random().toString(36).substr(2, 9);
    }

    updateStatus(message, type) {
        if (!this.statusDiv) return;
        this.statusDiv.textContent = message;
        this.statusDiv.className = `status ${type}`;
        console.log(`[${type.toUpperCase()}] ${message}`);
    }

    async handleIceCandidate(message) {
        const peerId = message.sender_id;
        const pc = this.peerConnections.get(peerId);
        if (pc) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(message.data));
            } catch (e) {
                console.error("Error adding ICE candidate", e);
            }
        }
    }
}
