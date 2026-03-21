// static/js/viewer.js
import { Cam2WebRTCBase } from './base.js';

export class Cam2WebRTCViewer extends Cam2WebRTCBase {
    constructor() {
        super();
        this.roomIdInput = document.getElementById('roomId');
        this.videoGrid = document.getElementById('videoGrid');
        this.connectionCountSpan = document.getElementById('connectionCount');

        this.roomId = null;
        this.autoConnectMode = false;
        this.connectionId = this.generateConnectionId('viewer');

        this.model = null; // TF model
        this.inferenceIntervals = new Map();

        // inference settings
        this.inferenceIntervalMs = 1000;
        this.useScale = true;
        this.inferenceScale = 0.5;
        this.frameSkip = 0;
        this.scoreThreshold = 0.5;
        this.maxDetections = 20;

        this.initializeEventListeners();
        this.loadConfig();
        this.loadModel();
        this.setupInferenceControls();
    }

    setupInferenceControls() {
        const intervalInput = document.getElementById('inferenceIntervalMs');
        const useScaleCb = document.getElementById('useScale');
        const scaleInput = document.getElementById('inferenceScale');
        const frameSkipInput = document.getElementById('frameSkip');
        const scoreThresholdInput = document.getElementById('scoreThreshold');
        const maxDetectionsInput = document.getElementById('maxDetections');

        if (intervalInput) {
            intervalInput.value = String(this.inferenceIntervalMs);
            intervalInput.addEventListener('change', (e) => {
                const v = parseInt(intervalInput.value || '1000', 10);
                this.inferenceIntervalMs = Math.max(50, isNaN(v) ? 1000 : v);
                this.updateStatus(`推論間隔: ${this.inferenceIntervalMs}ms`, 'info');
                this.restartAllInference();
            });
        }

        if (useScaleCb) {
            useScaleCb.checked = this.useScale;
            useScaleCb.addEventListener('change', () => {
                this.useScale = useScaleCb.checked;
                this.updateStatus(`スケール入力: ${this.useScale ? '有効' : '無効'}`, 'info');
                this.restartAllInference();
            });
        }

        if (scaleInput) {
            scaleInput.value = String(this.inferenceScale);
            scaleInput.addEventListener('change', () => {
                let v = parseFloat(scaleInput.value || '0.5');
                if (isNaN(v) || v <= 0) v = 0.5;
                this.inferenceScale = Math.min(1.0, Math.max(0.1, v));
                scaleInput.value = String(this.inferenceScale);
                this.updateStatus(`入力スケール: ${this.inferenceScale}`, 'info');
                this.restartAllInference();
            });
        }

        if (frameSkipInput) {
            frameSkipInput.value = String(this.frameSkip);
            frameSkipInput.addEventListener('change', () => {
                const v = parseInt(frameSkipInput.value || '0', 10);
                this.frameSkip = Math.max(0, isNaN(v) ? 0 : v);
                this.updateStatus(`フレームスキップ: ${this.frameSkip}`, 'info');
                this.restartAllInference();
            });
        }

        if (scoreThresholdInput) {
            scoreThresholdInput.value = String(this.scoreThreshold);
            scoreThresholdInput.addEventListener('change', () => {
                let v = parseFloat(scoreThresholdInput.value || '0.5');
                if (isNaN(v)) v = 0.5;
                this.scoreThreshold = Math.min(1.0, Math.max(0, v));
                scoreThresholdInput.value = String(this.scoreThreshold);
                this.updateStatus(`スコア閾値: ${this.scoreThreshold.toFixed(2)}`, 'info');
            });
        }

        if (maxDetectionsInput) {
            maxDetectionsInput.value = String(this.maxDetections);
            maxDetectionsInput.addEventListener('change', () => {
                const v = parseInt(maxDetectionsInput.value || '20', 10);
                this.maxDetections = Math.max(1, isNaN(v) ? 20 : v);
                this.updateStatus(`最大検出数: ${this.maxDetections}`, 'info');
            });
        }
    }

    restartAllInference() {
        for (const senderId of Array.from(this.inferenceIntervals.keys())) {
            try {
                this.stopInferenceForVideo(senderId);
                const container = document.getElementById(`video-${senderId}`);
                if (container) {
                    const videoElem = container.querySelector('video');
                    if (videoElem) {
                        this.startInferenceForVideo(senderId, videoElem);
                    }
                }
            } catch (e) {
                console.error('Error restarting inference for', senderId, e);
            }
        }
    }

    async loadModel() {
        try {
            this.updateStatus('TFモデル読み込み中...', 'info');
            // global cocoSsd
            this.model = await window.cocoSsd.load();
            this.updateStatus('TFモデル読み込み完了', 'success');
        } catch (e) {
            console.error('モデル読み込み失敗', e);
            this.updateStatus('TFモデルの読み込みに失敗しました', 'error');
        }
    }

    initializeEventListeners() {
        document.getElementById('connectRoom')?.addEventListener('click', () => this.connectToRoom());
        document.getElementById('autoConnect')?.addEventListener('click', () => this.toggleAutoConnect());

        const urlParams = new URLSearchParams(window.location.search);
        const roomId = urlParams.get('room');
        if (roomId && this.roomIdInput) {
            this.roomIdInput.value = roomId;
            this.connectToRoom();
        }
    }

    async connectToRoom() {
        const roomId = this.roomIdInput?.value.trim();
        if (!roomId) {
            this.updateStatus('ルームIDを入力してください', 'error');
            return;
        }

        this.roomId = roomId;
        await this.startConnection();
    }

    toggleAutoConnect() {
        this.autoConnectMode = !this.autoConnectMode;
        const btn = document.getElementById('autoConnect');

        if (this.autoConnectMode) {
            if (btn) {
                btn.textContent = '自動接続停止';
                btn.className = 'btn-primary';
            }
            this.startAutoConnect();
            this.updateStatus('自動接続モードを開始', 'info');
        } else {
            if (btn) {
                btn.textContent = '自動接続モード';
                btn.className = 'btn-secondary';
            }
            this.stopAutoConnect();
            this.updateStatus('自動接続モードを停止', 'info');
        }
    }

    startAutoConnect() {
        this.autoConnectInterval = setInterval(() => {
            this.checkForRooms();
        }, 5000);
    }

    stopAutoConnect() {
        if (this.autoConnectInterval) {
            clearInterval(this.autoConnectInterval);
            this.autoConnectInterval = null;
        }
    }

    async checkForRooms() {
        const commonRoomIds = ['demo', 'test', 'public'];
        for (const roomId of commonRoomIds) {
            try {
                const response = await fetch(`/api/rooms/${roomId}`);
                if (response.ok) {
                    if (this.roomIdInput) this.roomIdInput.value = roomId;
                    this.updateStatus(`ルーム ${roomId} を検出しました`, 'success');
                    await this.connectToRoom();
                    break;
                }
            } catch (error) { }
        }
    }

    async startConnection() {
        try {
            this.updateStatus(`ルーム ${this.roomId} に接続中...`, 'info');

            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            this.ws = new WebSocket(`${protocol}//${window.location.host}/ws/${this.roomId}`);

            this.ws.onopen = () => {
                this.updateStatus('WebSocket接続完了', 'success');
                this.joinRoom();
            };

            this.ws.onmessage = (event) => {
                this.handleSignalingMessage(JSON.parse(event.data));
            };

            this.ws.onerror = (error) => {
                this.updateStatus(`WebSocketエラー`, 'error');
            };

            this.ws.onclose = () => {
                this.updateStatus('WebSocket接続が切断されました', 'error');
                if (this.autoConnectMode) {
                    setTimeout(() => this.startConnection(), 3000);
                }
            };
        } catch (error) {
            this.updateStatus(`接続エラー: ${error.message}`, 'error');
        }
    }

    joinRoom() {
        const message = {
            type: 'join',
            connection_id: this.connectionId,
            is_sender: false
        };
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
    }

    async handleSignalingMessage(message) {
        switch (message.type) {
            case 'room_info':
                this.updateStatus(`ルームに接続しました (P2P Mesh)`, 'info');
                if (message.data.connection_count !== undefined && this.connectionCountSpan) {
                    this.connectionCountSpan.textContent = message.data.connection_count;
                }
                break;

            case 'new_peer':
                if (message.data.connection_count !== undefined && this.connectionCountSpan) {
                    this.connectionCountSpan.textContent = message.data.connection_count;
                }
                break;

            case 'leave':
                this.updateStatus(`ピアが退出しました: ${message.data.connection_id}`, 'info');
                if (message.data.connection_count !== undefined && this.connectionCountSpan) {
                    this.connectionCountSpan.textContent = message.data.connection_count;
                }
                if (this.peerConnections.has(message.data.connection_id)) {
                    this.peerConnections.get(message.data.connection_id).close();
                    this.peerConnections.delete(message.data.connection_id);
                    this.stopInferenceForVideo(message.data.connection_id);
                    const container = document.getElementById(`video-${message.data.connection_id}`);
                    if (container) container.remove();
                }
                break;

            case 'offer':
                await this.handleOffer(message);
                break;

            case 'ice_candidate':
                await this.handleIceCandidate(message);
                break;

            case 'error':
                this.updateStatus(`エラー: ${message.data.error}`, 'error');
                break;
        }
    }

    async handleOffer(message) {
        const senderId = message.sender_id;
        this.updateStatus(`オファーを受信 (Sender: ${senderId})`, 'info');

        if (this.peerConnections.has(senderId)) {
            this.peerConnections.get(senderId).close();
        }

        const config = {
            iceServers: this.config?.ice_servers || [
                { urls: 'stun:localhost:3478' }
            ]
        };

        const pc = new RTCPeerConnection(config);
        this.peerConnections.set(senderId, pc);

        let videoContainer = document.getElementById(`video-${senderId}`);
        if (!videoContainer) {
            videoContainer = document.createElement('div');
            videoContainer.id = `video-${senderId}`;
            videoContainer.className = 'video-item';
            const title = document.createElement('h4');
            title.textContent = `Sender: ${senderId}`;
            const video = document.createElement('video');
            video.autoplay = true;
            video.playsInline = true;
            video.controls = true;
            videoContainer.appendChild(title);
            videoContainer.appendChild(video);
            this.videoGrid.appendChild(videoContainer);
        }

        const videoElement = videoContainer.querySelector('video');

        pc.ontrack = (event) => {
            if (event.streams && event.streams[0]) {
                videoElement.srcObject = event.streams[0];
                this.updateStatus('映像を受信中...', 'success');
                videoElement.addEventListener('playing', () => {
                    this.startInferenceForVideo(senderId, videoElement);
                }, { once: true });
            }
        };

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                const candidateMessage = {
                    type: 'ice_candidate',
                    connection_id: senderId,
                    sender_id: this.connectionId,
                    data: event.candidate
                };
                this.ws.send(JSON.stringify(candidateMessage));
            }
        };

        try {
            await pc.setRemoteDescription(new RTCSessionDescription(message.data));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            const answerMessage = {
                type: 'answer',
                connection_id: senderId,
                sender_id: this.connectionId,
                data: answer
            };
            this.ws.send(JSON.stringify(answerMessage));
            this.updateStatus('アンサー送信完了', 'success');
        } catch (error) {
            this.updateStatus(`オファー処理エラー: ${error.message}`, 'error');
        }
    }

    startInferenceForVideo(senderId, videoElement) {
        if (!this.model) return;
        if (this.inferenceIntervals.has(senderId)) return;

        let container = document.getElementById(`video-${senderId}`);
        container.style.position = 'relative';

        let overlay = container.querySelector('.detection-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'detection-overlay';
            Object.assign(overlay.style, {
                position: 'absolute', left: '6px', top: '6px', padding: '6px',
                fontSize: '12px', background: 'rgba(255,255,255,0.7)',
                borderRadius: '4px', color: '#222', zIndex: '5'
            });
            container.appendChild(overlay);
        }

        let canvas = container.querySelector('.detection-canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.className = 'detection-canvas';
            Object.assign(canvas.style, {
                position: 'absolute', left: '0', top: '0',
                width: '100%', height: '100%', pointerEvents: 'none', zIndex: '4'
            });
            container.appendChild(canvas);
        }
        const ctx = canvas.getContext('2d');

        const resizeCanvas = () => {
            const vw = videoElement.videoWidth || videoElement.clientWidth;
            const vh = videoElement.videoHeight || videoElement.clientHeight;
            if (vw && vh) {
                canvas.width = vw;
                canvas.height = vh;
            }
        };

        let offscreen = null;
        let frameCount = 0;

        const interval = setInterval(async () => {
            try {
                if (videoElement.readyState < 2) return;
                if (this.frameSkip > 0 && frameCount % (this.frameSkip + 1) !== 0) {
                    frameCount++; return;
                }
                frameCount++;
                resizeCanvas();

                const scale = this.useScale ? this.inferenceScale : 1.0;
                let predictions = [];

                if (scale < 1) {
                    if (!offscreen) offscreen = document.createElement('canvas');
                    const vw = videoElement.videoWidth || videoElement.clientWidth;
                    const vh = videoElement.videoHeight || videoElement.clientHeight;
                    offscreen.width = Math.round(vw * scale);
                    offscreen.height = Math.round(vh * scale);
                    const offctx = offscreen.getContext('2d');
                    offctx.drawImage(videoElement, 0, 0, offscreen.width, offscreen.height);
                    predictions = await this.model.detect(offscreen);
                } else {
                    predictions = await this.model.detect(videoElement);
                }

                predictions = predictions.filter(p => p.score >= this.scoreThreshold).slice(0, this.maxDetections);
                overlay.innerHTML = predictions.slice(0, 3).map(p => `${p.class} (${(p.score * 100).toFixed(0)}%)`).join('<br>') || '検出なし';

                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.lineWidth = Math.max(2, Math.round(canvas.width / 200));
                ctx.font = `${Math.max(12, Math.round(canvas.width / 50))}px Arial`;
                const scaleBack = 1.0 / scale;

                predictions.forEach(p => {
                    const x = p.bbox[0] * scaleBack;
                    const y = p.bbox[1] * scaleBack;
                    const w = p.bbox[2] * scaleBack;
                    const h = p.bbox[3] * scaleBack;
                    ctx.strokeStyle = 'rgba(0,200,0,0.9)';
                    ctx.fillStyle = 'rgba(0,200,0,0.2)';
                    ctx.strokeRect(x, y, w, h);
                    const label = `${p.class} ${(p.score * 100).toFixed(0)}%`;
                    const tw = ctx.measureText(label).width;
                    const th = parseInt(ctx.font, 10) + 4;
                    ctx.fillStyle = 'rgba(0,200,0,0.7)';
                    ctx.fillRect(x, Math.max(0, y - th), tw + 6, th);
                    ctx.fillStyle = '#fff';
                    ctx.fillText(label, x + 3, Math.max(0, y - 4));
                });

                this.sendInferenceResults(senderId, predictions.map(p => ({
                    class: p.class, score: p.score,
                    bbox: [p.bbox[0] * scaleBack, p.bbox[1] * scaleBack, p.bbox[2] * scaleBack, p.bbox[3] * scaleBack]
                })));

            } catch (e) { console.error('Inference error', e); }
        }, this.inferenceIntervalMs);

        videoElement.addEventListener('loadedmetadata', resizeCanvas, { once: true });
        window.addEventListener('resize', resizeCanvas);
        this.inferenceIntervals.set(senderId, { intervalId: interval, canvasListener: resizeCanvas });
    }

    stopInferenceForVideo(senderId) {
        if (this.inferenceIntervals.has(senderId)) {
            const info = this.inferenceIntervals.get(senderId);
            clearInterval(info.intervalId);
            window.removeEventListener('resize', info.canvasListener);
            this.inferenceIntervals.delete(senderId);
        }
    }

    sendInferenceResults(sourceSenderId, predictions) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const message = {
            type: 'inference_result',
            room_id: this.roomId,
            sender_id: this.connectionId,
            source_sender_id: sourceSenderId,
            data: { timestamp: Date.now(), predictions }
        };
        this.ws.send(JSON.stringify(message));
    }
}
