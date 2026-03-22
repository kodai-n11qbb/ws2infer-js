// static/js/sender.js
import { Cam2WebRTCBase } from './base.js';

export class Cam2WebRTCSender extends Cam2WebRTCBase {
    constructor(dependencies = {}) {
        super(dependencies);
        this.localVideo = this.document ? this.document.getElementById('localVideo') : null;
        this.roomIdSpan = this.document ? this.document.getElementById('roomId') : null;
        this.roomModeSpan = this.document ? this.document.getElementById('roomMode') : null;
        this.connectionCountSpan = this.document ? this.document.getElementById('connectionCount') : null;

        this.roomIdInput = this.document ? this.document.getElementById('roomIdInput') : null;
        this.localStream = null;
        this.roomId = 'default-room';
        this.connectionId = this.generateConnectionId('sender');
        this.roomMode = '1onN';

        this.initializeEventListeners();
        this.init();
    }

    async init() {
        await this.loadConfig();
        this.updateStatus('初期化完了', 'info');
    }

    initializeEventListeners() {
        if (!this.document) return;
        this.document.getElementById('startCamera')?.addEventListener('click', () => this.startCamera());
        this.document.getElementById('createRoom')?.addEventListener('click', () => this.createRoom());
        this.document.getElementById('startStreaming')?.addEventListener('click', () => this.startStreaming());

        // URLパラメータからルームIDを取得
        if (typeof window !== 'undefined') {
            const urlParams = new URLSearchParams(window.location.search);
            let roomId = urlParams.get('room');
            if (!roomId && this.roomIdInput) {
                roomId = this.roomIdInput.value.trim();
            }

            if (roomId) {
                this.roomId = roomId;
                if (this.roomIdSpan) this.roomIdSpan.textContent = this.roomId;
                if (this.roomIdInput) this.roomIdInput.value = this.roomId;
            }
        }

        this.roomIdInput?.addEventListener('input', () => {
            this.roomId = this.roomIdInput.value.trim();
            if (this.roomIdSpan) this.roomIdSpan.textContent = this.roomId;
        });
    }

    async startCamera() {
        try {
            this.updateStatus('カメラを起動中...', 'info');

            const constraints = {
                video: this.config?.video_constraints || {
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: true
            };

            if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
                this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
                if (this.localVideo) this.localVideo.srcObject = this.localStream;

                const startBtn = this.document.getElementById('startCamera');
                if (startBtn) startBtn.disabled = true;
                
                const createBtn = this.document.getElementById('createRoom');
                if (createBtn) createBtn.disabled = false;
                
                const streamBtn = this.document.getElementById('startStreaming');
                if (streamBtn) streamBtn.disabled = false;

                this.updateStatus('カメラが正常に起動しました', 'success');
                if (this.roomIdSpan) this.roomIdSpan.textContent = this.roomId;
            }
        } catch (error) {
            this.updateStatus(`カメラ起動エラー: ${error.message}`, 'error');
        }
    }

    async createRoom() {
        try {
            this.updateStatus('ルームを作成中...', 'info');

            const room_id = this.roomId || null;

            const response = await this.fetch('/api/rooms', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ room_id })
            });

            if (!response.ok) {
                throw new Error('ルーム作成に失敗しました');
            }

            const roomData = await response.json();
            this.roomId = roomData.room_id;

            if (this.roomIdSpan) this.roomIdSpan.textContent = this.roomId;
            if (this.roomIdInput) this.roomIdInput.value = this.roomId;

            const createBtn = this.document.getElementById('createRoom');
            if (createBtn) createBtn.disabled = true;
            
            const streamBtn = this.document.getElementById('startStreaming');
            if (streamBtn) streamBtn.disabled = false;

            this.updateStatus(`ルーム作成完了: ${this.roomId}`, 'success');

            if (typeof window !== 'undefined') {
                const url = new URL(window.location);
                url.searchParams.set('room', this.roomId);
                window.history.pushState({}, '', url);
            }

        } catch (error) {
            this.updateStatus(`ルーム作成エラー: ${error.message}`, 'error');
        }
    }

    async startStreaming() {
        try {
            this.updateStatus('WebSocket接続中...', 'info');

            const protocol = (typeof window !== 'undefined' && window.location.protocol === 'https:') ? 'wss:' : 'ws:';
            const host = (typeof window !== 'undefined') ? window.location.host : 'localhost:8080';
            this.ws = new this.WebSocket(`${protocol}//${host}/ws/${this.roomId}`);

            this.ws.onopen = () => {
                this.updateStatus('WebSocket接続完了', 'success');
                this.joinRoom();
            };

            this.ws.onmessage = (event) => {
                this.handleSignalingMessage(JSON.parse(event.data));
            };

            this.ws.onerror = (error) => {
                this.updateStatus(`WebSocketエラー: ${error}`, 'error');
            };

            this.ws.onclose = () => {
                this.updateStatus('WebSocket接続が切断されました', 'error');
            };

            const streamBtn = this.document.getElementById('startStreaming');
            if (streamBtn) streamBtn.disabled = true;
        } catch (error) {
            this.updateStatus(`配信開始エラー: ${error.message}`, 'error');
        }
    }

    joinRoom() {
        const message = {
            type: 'join',
            connection_id: this.connectionId,
            is_sender: true
        };
        this.ws.send(JSON.stringify(message));
    }

    async handleSignalingMessage(message) {
        switch (message.type) {
            case 'room_info':
                if (this.connectionCountSpan) this.connectionCountSpan.textContent = message.data.connection_count;
                this.updateStatus('ルーム参加完了。視聴者の待機中...', 'info');

                if (message.data.peers) {
                    for (const peer of message.data.peers) {
                        if (!peer.is_sender) {
                            await this.initiateConnection(peer.id);
                        }
                    }
                }
                break;

            case 'new_peer':
                if (message.data.connection_count !== undefined && this.connectionCountSpan) {
                    this.connectionCountSpan.textContent = message.data.connection_count;
                }
                if (!message.data.is_sender) {
                    this.updateStatus(`新しい視聴者が参加しました: ${message.data.connection_id}`, 'info');
                    await this.initiateConnection(message.data.connection_id);
                }
                break;

            case 'leave':
                this.updateStatus(`ピアが退出しました: ${message.data.connection_id}`, 'info');
                if (message.data.connection_count !== undefined && this.connectionCountSpan) {
                    this.connectionCountSpan.textContent = message.data.connection_count;
                }
                if (this.peerConnections.has(message.data.connection_id)) {
                    const pc = this.peerConnections.get(message.data.connection_id);
                    pc.close();
                    this.peerConnections.delete(message.data.connection_id);
                }
                break;

            case 'answer':
                await this.handleAnswer(message);
                break;

            case 'ice_candidate':
                await this.handleIceCandidate(message);
                break;

            case 'error':
                this.updateStatus(`エラー: ${message.data.error}`, 'error');
                break;
        }
    }

    async initiateConnection(targetPeerId) {
        if (this.peerConnections.has(targetPeerId)) {
            console.log(`Connection to ${targetPeerId} already exists/initiating.`);
            return;
        }

        this.updateStatus(`${targetPeerId} と接続を開始します...`, 'info');
        const pc = await this.createPeerConnection(targetPeerId);

        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            const message = {
                type: 'offer',
                connection_id: targetPeerId,
                sender_id: this.connectionId,
                data: offer
            };
            this.ws.send(JSON.stringify(message));
            this.updateStatus(`オファー送信 (To: ${targetPeerId})`, 'success');
        } catch (e) {
            this.updateStatus(`オファー作成エラー: ${e.message}`, 'error');
        }
    }

    async createPeerConnection(targetPeerId) {
        const config = {
            iceServers: this.config?.ice_servers || [
                { urls: 'stun:localhost:3478' }
            ]
        };

        const pc = new this.RTCPeerConnection(config);

        if (targetPeerId) {
            this.peerConnections.set(targetPeerId, pc);
        }

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
            });
        }

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                const message = {
                    type: 'ice_candidate',
                    connection_id: targetPeerId,
                    sender_id: this.connectionId,
                    data: event.candidate
                };
                this.ws.send(JSON.stringify(message));
            }
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                if (targetPeerId && this.peerConnections.get(targetPeerId) === pc) {
                    this.peerConnections.delete(targetPeerId);
                }
            }
        };

        return pc;
    }

    async handleAnswer(message) {
        const peerId = message.sender_id;
        const pc = this.peerConnections.get(peerId);

        if (pc && this.RTCSessionDescription) {
            this.updateStatus(`アンサーを受信 (From: ${peerId})`, 'success');
            try {
                await pc.setRemoteDescription(new this.RTCSessionDescription(message.data));
            } catch (e) {
                console.error("SetRemoteDescription Error", e);
            }
        }
    }
}
