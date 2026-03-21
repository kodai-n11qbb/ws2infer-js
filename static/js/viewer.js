// static/js/viewer.js
import { Cam2WebRTCBase } from './base.js';

/**
 * Interface-like base class for inference engines
 */
export class InferenceEngine {
    constructor() {
        this.ready = false;
        this.busy = false;
    }
    async load() { this.ready = true; }
    async detect(element) { return []; }
    render(ctx, predictions, canvas, scaleBack) { }
}

/**
 * Object detection using COCO-SSD (via TensorFlow.js GPU)
 */
export class CocoSsdEngine extends InferenceEngine {
    constructor() {
        super();
        this.model = null;
    }
    async load() {
        this.model = await window.cocoSsd.load();
        this.ready = true;
    }
    async detect(element) {
        if (!this.ready || this.busy) return [];
        this.busy = true;
        try {
            return await this.model.detect(element);
        } finally {
            this.busy = false;
        }
    }
    render(ctx, predictions, canvas, scaleBack) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.lineWidth = Math.max(2, Math.round(canvas.width / 200));
        ctx.font = `${Math.max(12, Math.round(canvas.width / 50))}px Arial`;

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
    }
}

/**
 * Full Text Recognition using OCRS (Rust -> WASM) via Web Worker.
 * Follows the article: WASM OCR Integration.
 */
/**
 * Full Text Recognition using ndlocr-lite-wasm via Web Worker.
 * Follows DEV_POLICY.md by avoiding unnecessary abstractions.
 */
export class NdlocrEngine extends InferenceEngine {
    constructor() {
        super();
        this.worker = null;
        this.pendingResolves = new Map();
        this.messageId = 0;
    }
    async load() {
        return new Promise((resolve, reject) => {
            console.log('[NDLOCR] Loading worker...');
            // Use the built assets from static/ndlocr/assets
            // The exact worker JS name will be matched dynamically or we updated vite.config to produce non-hashed names.
            // Vite config was configured to output: assets/[name].js
            this.worker = new Worker("/ndlocr/assets/ocr.worker.js", { type: "module" });

            this.worker.onmessage = (e) => {
                const msg = e.data;
                console.log('[NDLOCR] Worker message:', msg);
                if (msg.type === "init-done") {
                    console.log('[NDLOCR] Worker initialization completed');
                    this.ready = true;
                    resolve();
                } else if (msg.type === "result" || msg.type === "error") {
                    const cb = this.pendingResolves.get("ndlocr-job");
                    if (cb) {
                        this.pendingResolves.delete("ndlocr-job");
                        if (msg.type === "result") cb.resolve(msg.lines);
                        else cb.reject(new Error(msg.message));
                    }
                } else if (msg.type === "init-progress") {
                    const loadedMB = (msg.loaded / 1024 / 1024).toFixed(1);
                    const totalMB = (msg.total > 0) ? (msg.total / 1024 / 1024).toFixed(1) : "?";
                    console.log(`[NDLOCR] モデルダウンロード中... ${msg.model}: ${loadedMB}MB / ${totalMB}MB`);
                } else if (msg.type === "recognize-progress") {
                    // console.log(`[NDLOCR] 認識中... ${msg.current} / ${msg.total}`);
                }
            };
            this.worker.onerror = (err) => {
                console.error("NDLOCR Worker generic error:", err);
                reject(err);
            };

            // Initialize the Lite preset
            console.log('[NDLOCR] Sending init message to worker...');
            this.worker.postMessage({ type: "init", presetId: "lite" });
        });
    }
    async detect(element, viewerContext) {
        if (!this.ready || this.busy) return [];
        this.busy = true;
        try {
            const canvas = element;
            console.log('[NDLOCR] Starting OCR detection, canvas size:', canvas.width, 'x', canvas.height);

            // Send the full canvas to the NDLOCR worker — DEIM handles text detection internally
            const blob = await new Promise(r => canvas.toBlob(r, "image/jpeg", 0.9));
            if (!blob) {
                console.error('[NDLOCR] Failed to create blob from canvas');
                return [];
            }

            console.log('[NDLOCR] Created blob, size:', blob.size, 'bytes');

            const p = new Promise((resolve, reject) => {
                this.pendingResolves.set("ndlocr-job", { resolve, reject });
            });

            console.log('[NDLOCR] Sending message to worker...');
            this.worker.postMessage({
                type: "run",
                imageBlob: blob,
                presetId: "lite"
            });

            const ocrLines = await p;
            console.log('[NDLOCR] OCR completed, lines:', ocrLines?.length || 0);

            if (!ocrLines || ocrLines.length === 0) {
                console.log('[NDLOCR] No text detected');
                return [];
            }

            // Return each detected line as a separate prediction with its own bounding box
            const predictions = ocrLines
                .filter(line => line.text && line.text.trim().length > 0)
                .map(line => ({
                    class: line.text,
                    score: line.conf || 1.0,
                    bbox: [line.x, line.y, line.w, line.h]
                }));

            console.log('[NDLOCR] Processed predictions:', predictions.length);
            return predictions;
        } catch (e) {
            console.error("NDLOCR Inference failed", e);
            return [];
        } finally {
            this.busy = false;
        }
    }

    render(ctx, predictions, canvas, scaleBack) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!predictions || predictions.length === 0) return;

        const fontSize = Math.max(14, Math.round(canvas.width / 60));
        ctx.font = `bold ${fontSize}px "Hiragino Kaku Gothic ProN", "Meiryo", sans-serif`;
        ctx.lineWidth = 2;

        predictions.forEach(p => {
            if (!p.class) return;
            const x = p.bbox[0] * scaleBack;
            const y = p.bbox[1] * scaleBack;
            const w = p.bbox[2] * scaleBack;
            const h = p.bbox[3] * scaleBack;

            // Draw bounding box (like test page)
            ctx.strokeStyle = '#00ff88';
            ctx.strokeRect(x, y, w, h);

            // Draw text background
            const label = p.class;
            const metrics = ctx.measureText(label);
            const textWidth = metrics.width;
            const textHeight = fontSize + 4;
            const textX = x;
            const textY = Math.max(textHeight, y - 2);

            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(textX, textY - textHeight, textWidth + 8, textHeight + 2);

            // Draw text
            ctx.fillStyle = '#00ff88';
            ctx.fillText(label, textX + 4, textY - 4);
        });
    }
}


export class Cam2WebRTCViewer extends Cam2WebRTCBase {
    constructor(engines = {}) { // Dependency Injection
        super();
        this.roomIdInput = document.getElementById('roomId');
        this.videoGrid = document.getElementById('videoGrid');
        this.connectionCountSpan = document.getElementById('connectionCount');
        this.modelSelect = document.getElementById('modelSelect');

        this.roomId = 'demo';
        this.autoConnectMode = false;
        this.connectionId = this.generateConnectionId('viewer');

        this.engines = engines;
        this.currentEngineType = 'cocossd';
        this.inferenceIntervals = new Map();

        // inference settings
        this.inferenceIntervalMs = 1000;
        this.useScale = true;
        this.inferenceScale = 0.5;
        this.frameSkip = 0;
        this.scoreThreshold = 0.5;

        // advanced preprocessing
        this.useGrayscale = false;
        this.contrast = 1.0;
        this.brightness = 1.0;
        this.showDebugPreview = false;

        // ROI settings
        this.useRoi = false;
        this.roiX = 25; this.roiY = 25; this.roiW = 50; this.roiH = 50;

        this.initializeEventListeners();
        this.loadConfig();
        this.loadModel();
        this.setupInferenceControls();
    }

    setupInferenceControls() {
        // Utility method to escape HTML and prevent XSS
        this.escapeHtml = (text) => {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        };

        const attachListener = (id, prop, isBool = false, isFloat = true) => {
            const el = document.getElementById(id);
            if (!el) return;
            if (isBool) el.checked = this[prop];
            else el.value = String(this[prop]);

            el.addEventListener('change', () => {
                const val = isBool ? el.checked : (isFloat ? parseFloat(el.value) : parseInt(el.value));
                this[prop] = val;
                this.updateStatus(`${prop} updated`, 'info');
                if (id === 'showDebugPreview') {
                    const container = document.getElementById('debugPreviewContainer');
                    if (container) container.style.display = val ? 'block' : 'none';
                }
                if (id === 'useRoi') {
                    const controls = document.getElementById('roiControls');
                    if (controls) controls.style.display = val ? 'flex' : 'none';
                }
                this.restartAllInference();
            });
        };

        ['inferenceIntervalMs', 'inferenceScale', 'contrast', 'brightness', 'roiX', 'roiY', 'roiW', 'roiH'].forEach(id => attachListener(id, id, false, id !== 'inferenceIntervalMs'));
        ['useGrayscale', 'showDebugPreview', 'useRoi'].forEach(id => attachListener(id, id, true));

        if (this.modelSelect) {
            this.modelSelect.value = this.currentEngineType;
            this.modelSelect.addEventListener('change', async () => {
                const newType = this.modelSelect.value;
                if (newType !== this.currentEngineType) {
                    this.currentEngineType = newType;
                    this.updateStatus(`モデル切り替え中: ${newType}...`, 'info');
                    if (!this.engines[newType].ready) {
                        try {
                            await this.engines[newType].load();
                        } catch (e) {
                            this.updateStatus(`モデル読み込み失敗`, 'error');
                            return;
                        }
                    }
                    this.updateStatus(`モデル切り替え完了`, 'success');
                    this.restartAllInference();
                }
            });
        }
    }

    restartAllInference() {
        for (const senderId of Array.from(this.inferenceIntervals.keys())) {
            this.stopInferenceForVideo(senderId);
            const container = document.getElementById(`video-${senderId}`);
            if (container) {
                const videoElem = container.querySelector('video');
                if (videoElem) this.startInferenceForVideo(senderId, videoElem);
            }
        }
    }

    async loadModel() {
        try {
            this.updateStatus('初期モデル(COCO-SSD)読み込み中...', 'info');
            await this.engines.cocossd.load();
            this.updateStatus('初期モデル読み込み完了', 'success');
        } catch (e) {
            console.error('モデル読み込み失敗', e);
            this.updateStatus('初期モデルの読み込みに失敗しました', 'error');
        }
    }

    initializeEventListeners() {
        document.getElementById('connectRoom')?.addEventListener('click', () => this.connectToRoom());
        document.getElementById('autoConnect')?.addEventListener('click', () => this.toggleAutoConnect());
        const urlParams = new URLSearchParams(window.location.search);
        let roomId = urlParams.get('room');
        if (!roomId && this.roomIdInput) roomId = this.roomIdInput.value.trim();
        if (roomId && this.roomIdInput) { this.roomIdInput.value = roomId; this.connectToRoom(); }
    }

    async connectToRoom() {
        const roomId = this.roomIdInput?.value.trim();
        if (!roomId) return;
        this.roomId = roomId;
        await this.startConnection();
    }

    toggleAutoConnect() {
        this.autoConnectMode = !this.autoConnectMode;
        const btn = document.getElementById('autoConnect');
        if (this.autoConnectMode) {
            if (btn) { btn.textContent = '自動接続停止'; btn.className = 'btn-primary'; }
            this.startAutoConnect();
        } else {
            if (btn) { btn.textContent = '自動接続モード'; btn.className = 'btn-secondary'; }
            this.stopAutoConnect();
        }
    }

    startAutoConnect() {
        this.autoConnectInterval = setInterval(() => this.checkForRooms(), 5000);
    }
    stopAutoConnect() {
        if (this.autoConnectInterval) { clearInterval(this.autoConnectInterval); this.autoConnectInterval = null; }
    }
    async checkForRooms() {
        const commonRoomIds = ['demo', 'test', 'public'];
        for (const rId of commonRoomIds) {
            try {
                const response = await fetch(`/api/rooms/${rId}`);
                if (response.ok) {
                    if (this.roomIdInput) this.roomIdInput.value = rId;
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
            this.ws.onopen = () => { this.updateStatus('WebSocket接続完了', 'success'); this.joinRoom(); };
            this.ws.onmessage = (event) => this.handleSignalingMessage(JSON.parse(event.data));
            this.ws.onerror = (error) => this.updateStatus(`WebSocketエラー`, 'error');
            this.ws.onclose = () => {
                this.updateStatus('WebSocket接続断', 'error');
                if (this.autoConnectMode) setTimeout(() => this.startConnection(), 3000);
            };
        } catch (error) { this.updateStatus(`接続エラー: ${error.message}`, 'error'); }
    }

    joinRoom() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'join', connection_id: this.connectionId, is_sender: false }));
        }
    }

    async handleSignalingMessage(message) {
        switch (message.type) {
            case 'room_info':
            case 'new_peer':
                if (message.data.connection_count !== undefined && this.connectionCountSpan) this.connectionCountSpan.textContent = message.data.connection_count;
                break;
            case 'leave':
                if (message.data.connection_count !== undefined && this.connectionCountSpan) this.connectionCountSpan.textContent = message.data.connection_count;
                if (this.peerConnections.has(message.data.connection_id)) {
                    this.peerConnections.get(message.data.connection_id).close();
                    this.peerConnections.delete(message.data.connection_id);
                    this.stopInferenceForVideo(message.data.connection_id);
                    const container = document.getElementById(`video-${message.data.connection_id}`);
                    if (container) container.remove();
                }
                break;
            case 'offer': await this.handleOffer(message); break;
            case 'ice_candidate': await this.handleIceCandidate(message); break;
        }
    }

    async handleOffer(message) {
        const senderId = message.sender_id;
        if (this.peerConnections.has(senderId)) this.peerConnections.get(senderId).close();
        const pc = new RTCPeerConnection({ iceServers: this.config?.ice_servers || [{ urls: 'stun:localhost:3478' }] });
        this.peerConnections.set(senderId, pc);
        let container = document.getElementById(`video-${senderId}`);
        if (!container) {
            container = document.createElement('div');
            container.id = `video-${senderId}`; container.className = 'video-item';
            const title = document.createElement('h4'); title.textContent = `Sender: ${senderId}`;
            const wrapper = document.createElement('div'); wrapper.className = 'video-wrapper';
            const video = document.createElement('video'); video.autoplay = true; video.playsInline = true; video.controls = true;
            wrapper.appendChild(video);
            container.appendChild(title); container.appendChild(wrapper);
            this.videoGrid.appendChild(container);
        }
        const videoElement = container.querySelector('video');
        pc.ontrack = (event) => {
            if (event.streams && event.streams[0]) {
                videoElement.srcObject = event.streams[0];
                videoElement.addEventListener('playing', () => this.startInferenceForVideo(senderId, videoElement), { once: true });
            }
        };
        pc.onicecandidate = (event) => {
            if (event.candidate) this.ws.send(JSON.stringify({ type: 'ice_candidate', connection_id: senderId, sender_id: this.connectionId, data: event.candidate }));
        };
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(message.data));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            this.ws.send(JSON.stringify({ type: 'answer', connection_id: senderId, sender_id: this.connectionId, data: answer }));
        } catch (error) { this.updateStatus(`Offer処理エラー`, 'error'); }
    }

    startInferenceForVideo(senderId, videoElement) {
        if (this.inferenceIntervals.has(senderId)) return;
        let container = document.getElementById(`video-${senderId}`);
        const wrapper = container.querySelector('.video-wrapper');
        let canvas = wrapper.querySelector('.detection-canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.className = 'detection-canvas';
            wrapper.appendChild(canvas);
        }
        const ctx = canvas.getContext('2d');
        const resize = () => { canvas.width = videoElement.videoWidth; canvas.height = videoElement.videoHeight; };
        let offscreen = null;
        let frameCount = 0;
        const interval = setInterval(async () => {
            if (videoElement.readyState < 2) return;
            const engine = this.engines[this.currentEngineType];
            if (!engine || !engine.ready) return;
            if (this.frameSkip > 0 && frameCount++ % (this.frameSkip + 1) !== 0) return;
            resize();
            const scale = this.useScale ? this.inferenceScale : 1.0;
            const vw = videoElement.videoWidth; const vh = videoElement.videoHeight;
            const rx = this.useRoi ? Math.round(vw * (this.roiX / 100)) : 0;
            const ry = this.useRoi ? Math.round(vh * (this.roiY / 100)) : 0;
            const rw = this.useRoi ? Math.round(vw * (this.roiW / 100)) : vw;
            const rh = this.useRoi ? Math.round(vh * (this.roiH / 100)) : vh;
            if (!offscreen) offscreen = document.createElement('canvas');
            offscreen.width = Math.round(rw * scale); offscreen.height = Math.round(rh * scale);
            const offctx = offscreen.getContext('2d', { willReadFrequently: true });
            offctx.filter = `grayscale(${this.useGrayscale ? 100 : 0}%) contrast(${this.contrast}) brightness(${this.brightness})`;
            offctx.drawImage(videoElement, rx, ry, rw, rh, 0, 0, offscreen.width, offscreen.height);
            if (this.showDebugPreview) {
                const debugCanvas = document.getElementById('debugCanvas');
                if (debugCanvas) { debugCanvas.width = offscreen.width; debugCanvas.height = offscreen.height; debugCanvas.getContext('2d').drawImage(offscreen, 0, 0); }
            }
            const raw = await engine.detect(offscreen, {});
            const predictions = raw.map(p => ({ ...p, bbox: [(p.bbox[0] / scale) + rx, (p.bbox[1] / scale) + ry, p.bbox[2] / scale, p.bbox[3] / scale] }));
            engine.render(ctx, predictions, canvas, 1.0);
            if (this.useRoi) {
                ctx.strokeStyle = 'rgba(255, 255, 0, 0.7)'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]); ctx.strokeRect(rx, ry, rw, rh); ctx.setLineDash([]);
            }
            // Update OCR result panel if using OCR engine
            const ocrPanel = document.getElementById('ocrResultPanel');
            const ocrContent = document.getElementById('ocrResultContent');
            if (this.currentEngineType === 'ocr_gpu' && ocrPanel && ocrContent) {
                ocrPanel.classList.add('active');
                if (predictions.length > 0) {
                    ocrContent.innerHTML = predictions.map(p => {
                        const confPercent = (p.score * 100).toFixed(0);
                        return `<div class="ocr-line">${this.escapeHtml(p.class)}<span class="ocr-conf">(${confPercent}%)</span></div>`;
                    }).join('');
                } else {
                    ocrContent.textContent = 'テキストが検出されませんでした';
                }
            } else if (ocrPanel) {
                ocrPanel.classList.remove('active');
            }
            this.sendInferenceResults(senderId, predictions);
        }, this.inferenceIntervalMs);
        videoElement.addEventListener('loadedmetadata', resize);
        this.inferenceIntervals.set(senderId, { intervalId: interval, listener: resize });
    }

    stopInferenceForVideo(senderId) {
        if (this.inferenceIntervals.has(senderId)) {
            const info = this.inferenceIntervals.get(senderId);
            clearInterval(info.intervalId);
            this.inferenceIntervals.delete(senderId);
        }
    }

    sendInferenceResults(sourceId, predictions) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'inference_result', room_id: this.roomId, sender_id: this.connectionId, source_sender_id: sourceId, data: { timestamp: Date.now(), predictions } }));
        }
    }
}
