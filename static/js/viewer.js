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
    dispose() { this.ready = false; }
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
        if (this.ready) return;
        this.model = await window.cocoSsd.load();
        this.ready = true;
    }
    dispose() {
        super.dispose();
        this.model = null;
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
 * Full Text Recognition using ndlocr-lite-wasm via Web Worker.
 * Follows DEV_POLICY.md by implementing self-healing via watchdog timer.
 */
export class NdlocrEngine extends InferenceEngine {
    constructor(presetId = 'lite', onProgress = null) {
        super();
        this.worker = null;
        this.pendingResolves = new Map();
        this.presetId = presetId;
        this.onProgress = onProgress;
        this.loadingPromise = null;
        this.lastProcessAttempt = 0;
        this.lastPredictions = null;
        this.lastHash = null;
    }

    async load() {
        if (this.ready) return;
        if (this.loadingPromise) return this.loadingPromise;

        this.loadingPromise = new Promise((resolve, reject) => {
            console.log(`[NDLOCR] Initializing worker for preset: ${this.presetId}`);
            
            if (!this.worker) {
                const workerUrl = `/ndlocr/assets/ocr.worker.js?t=${Date.now()}`;
                this.worker = new Worker(workerUrl, { type: "module" });
            }

            this.worker.onmessage = (e) => {
                const msg = e.data;
                this.handleWorkerMessage(msg, (res) => {
                    this.loadingPromise = null;
                    resolve(res);
                }, (err) => {
                    this.loadingPromise = null;
                    reject(err);
                });
            };

            this.worker.onerror = (err) => {
                console.error("[NDLOCR] Worker error:", err);
                this.busy = false;
                this.loadingPromise = null;
                reject(err);
            };

            setTimeout(() => {
                if (!this.ready && this.loadingPromise) {
                    this.loadingPromise = null;
                    reject(new Error('NDLOCR Initialization timeout'));
                }
            }, 90000);

            this.worker.postMessage({ type: "init", presetId: this.presetId });
        });

        return this.loadingPromise;
    }

    handleWorkerMessage(msg, resolve, reject) {
        switch (msg.type) {
            case "init-done":
                this.ready = true;
                resolve();
                break;
            case "result":
                this.resolveJob(msg.lines);
                break;
            case "error":
                console.error("[NDLOCR] Error from worker:", msg.message);
                this.resolveJob(null, new Error(msg.message));
                break;
            case "init-progress":
                if (this.onProgress) {
                    this.onProgress(msg);
                }
                break;
        }
    }

    dispose() {
        super.dispose();
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }

    resolveJob(result, error = null) {
        this.busy = false;
        const job = this.pendingResolves.get("ndlocr-job");
        if (job) {
            this.pendingResolves.delete("ndlocr-job");
            if (error) job.reject(error);
            else job.resolve(result);
        }
    }

    async detect(canvas) {
        if (!this.ready || this.busy) {
            if (this.busy && Date.now() - this.lastProcessAttempt > 10000) {
                console.warn('[NDLOCR] Watchdog: Process timeout, resetting busy flag');
                this.busy = false;
            }
            if (!this.ready || this.busy) return [];
        }

        this.busy = true;
        this.lastProcessAttempt = Date.now();

        try {
            // Scene Hash check for efficiency
            if (!this.motionCanvas) {
                this.motionCanvas = document.createElement('canvas');
                this.motionCanvas.width = 16; this.motionCanvas.height = 16;
            }
            const mCtx = this.motionCanvas.getContext('2d', { willReadFrequently: true });
            mCtx.drawImage(canvas, 0, 0, 16, 16);
            const pixels = mCtx.getImageData(0, 0, 16, 16).data;
            let hash = 0;
            for (let i = 0; i < pixels.length; i += 4) hash += pixels[i] + pixels[i+1] + pixels[i+2];

            if (this.lastHash && Math.abs(hash - this.lastHash) < 500) {
                this.busy = false;
                return this.lastPredictions || [];
            }
            this.lastHash = hash;

            const blob = await new Promise(r => canvas.toBlob(r, "image/jpeg", 0.85));
            if (!blob) throw new Error("Blob creation failed");

            const predictionPromise = new Promise((resolve, reject) => {
                this.pendingResolves.set("ndlocr-job", { resolve, reject });
            });

            this.worker.postMessage({ type: "run", imageBlob: blob, presetId: this.presetId });
            const ocrLines = await predictionPromise;
            
            const predictions = (ocrLines || [])
                .filter(line => line.text && line.text.trim().length > 0)
                .map(line => ({
                    class: line.text,
                    score: line.conf || 1.0,
                    bbox: [line.x, line.y, line.w, line.h]
                }));
            
            this.lastPredictions = predictions;
            return predictions;
        } catch (e) {
            console.error("[NDLOCR] Inference error:", e);
            return this.lastPredictions || [];
        } finally {
            this.busy = false;
        }
    }

    render(ctx, predictions, canvas, scaleBack) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!predictions || predictions.length === 0) return;
        const fontSize = Math.max(14, Math.round(canvas.width / 60));
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.lineWidth = 2;
        predictions.forEach(p => {
            const [x, y, w, h] = p.bbox.map(v => v * scaleBack);
            ctx.strokeStyle = '#00ff88';
            ctx.strokeRect(x, y, w, h);
            const label = p.class;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(x, Math.max(0, y - fontSize - 4), ctx.measureText(label).width + 8, fontSize + 6);
            ctx.fillStyle = '#00ff88';
            ctx.fillText(label, x + 4, Math.max(fontSize, y - 4));
        });
    }
}

export class Cam2WebRTCViewer extends Cam2WebRTCBase {
    constructor(engines = {}) {
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
        this.inferenceIntervalMs = 1500;

        // DI-ready setup for engines
        Object.keys(this.engines).forEach(key => {
            if (this.engines[key] instanceof NdlocrEngine) {
                this.engines[key].onProgress = (p) => {
                    const pct = p.total > 0 ? Math.round((p.loaded / p.total) * 100) : '?';
                    this.updateStatus(`${p.model} 読込中: ${pct}%`, 'info');
                };
            }
        });

        this.useScale = true;
        this.inferenceScale = 0.5;
        this.frameSkip = 0;
        this.useGrayscale = false;
        this.contrast = 1.0;
        this.brightness = 1.0;
        this.showDebugPreview = false;
        this.useRoi = false;
        this.roiX = 25; this.roiY = 25; this.roiW = 50; this.roiH = 50;

        this.initializeEventListeners();
        this.init();
        this.setupInferenceControls();
    }

    async init() {
        await this.loadConfig();
        await this.loadModel();
        this.updateStatus('初期化完了', 'info');
    }

    setupInferenceControls() {
        this.escapeHtml = (text) => {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        };

        const attachListener = (id, prop, isBool = false, isFloat = true) => {
            const el = document.getElementById(id);
            if (!el) return;
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
                const prevType = this.currentEngineType;
                const newType = this.modelSelect.value;
                if (newType === prevType) return;

                this.currentEngineType = newType;
                this.updateStatus(`モデル切り替え中: ${newType}...`, 'info');

                if (newType === 'ocr_gpu') {
                    this.inferenceScale = 1.0;
                    this.inferenceIntervalMs = 2000;
                } else {
                    this.inferenceScale = 0.5;
                    this.inferenceIntervalMs = 1000;
                }

                const syncUI = (id, val, isProp = 'value') => {
                    const el = document.getElementById(id);
                    if (el) el[isProp] = val;
                };
                syncUI('inferenceScale', this.inferenceScale);
                syncUI('inferenceIntervalMs', this.inferenceIntervalMs);

                // Dispose old if needed (Not fully implemented but hook is there)
                if (this.engines[prevType]?.dispose) this.engines[prevType].dispose();

                if (!this.engines[newType].ready) {
                    try {
                        await this.engines[newType].load();
                    } catch (e) {
                        console.error('[VIEWER] Engine load failed:', e);
                        this.updateStatus(`モデル読み込み失敗: ${e.message}`, 'error');
                        this.modelSelect.value = prevType;
                        this.currentEngineType = prevType;
                        return;
                    }
                }
                this.updateStatus(`モデル切り替え完了 (${newType})`, 'success');
                this.restartAllInference();
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
            this.updateStatus('初期モデル読み込み中...', 'info');
            await this.engines.cocossd.load();
            this.updateStatus('初期モデル読み込み完了', 'success');
        } catch (e) {
            console.error('初期モデル読み込み失敗', e);
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

    startAutoConnect() { this.autoConnectInterval = setInterval(() => this.checkForRooms(), 5000); }
    stopAutoConnect() { if (this.autoConnectInterval) { clearInterval(this.autoConnectInterval); this.autoConnectInterval = null; } }
    async checkForRooms() {
        const commonRoomIds = ['demo', 'test', 'public'];
        for (const rId of commonRoomIds) {
            try {
                const response = await fetch(`/api/rooms/${rId}`);
                if (response.ok) {
                    if (this.roomIdInput) this.roomIdInput.value = rId;
                    await this.connectToRoom(); break;
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
        let runner = { active: true };
        const loop = async () => {
            if (!runner.active) return;
            if (videoElement.readyState < 2) { setTimeout(loop, 500); return; }

            const engine = this.engines[this.currentEngineType];
            if (!engine || !engine.ready) { setTimeout(loop, 1000); return; }

            resize();
            const start = Date.now();
            const scale = this.inferenceScale || 1.0;
            const vw = videoElement.videoWidth, vh = videoElement.videoHeight;
            const rx = this.useRoi ? Math.round(vw * (this.roiX / 100)) : 0;
            const ry = this.useRoi ? Math.round(vh * (this.roiY / 100)) : 0;
            const rw = this.useRoi ? Math.round(vw * (this.roiW / 100)) : vw;
            const rh = this.useRoi ? Math.round(vh * (this.roiH / 100)) : vh;

            this.offscreen = this.offscreen || document.createElement('canvas');
            const targetW = Math.round(rw * scale);
            const targetH = Math.round(rh * scale);
            if (this.offscreen.width !== targetW) {
                this.offscreen.width = targetW;
                this.offscreen.height = targetH;
            }
            const offctx = this.offscreen.getContext('2d', { willReadFrequently: true });
            offctx.filter = `grayscale(${this.useGrayscale ? 100 : 0}%) contrast(${this.contrast}) brightness(${this.brightness})`;
            offctx.drawImage(videoElement, rx, ry, rw, rh, 0, 0, targetW, targetH);

            if (this.showDebugPreview) {
                const debugCanvas = document.getElementById('debugCanvas');
                if (debugCanvas) {
                    debugCanvas.width = targetW; debugCanvas.height = targetH;
                    debugCanvas.getContext('2d').drawImage(this.offscreen, 0, 0);
                }
            }

            const raw = await engine.detect(this.offscreen);
            const predictions = raw.map(p => ({
                ...p,
                bbox: [(p.bbox[0] / scale) + rx, (p.bbox[1] / scale) + ry, p.bbox[2] / scale, p.bbox[3] / scale]
            }));

            engine.render(ctx, predictions, canvas, 1.0);
            if (this.useRoi) {
                ctx.strokeStyle = 'rgba(255, 255, 0, 0.7)'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
                ctx.strokeRect(rx, ry, rw, rh); ctx.setLineDash([]);
            }

            this.updateOcrUI(predictions);
            this.sendInferenceResults(senderId, predictions);

            const elapsed = Date.now() - start;
            setTimeout(loop, Math.max(10, this.inferenceIntervalMs - elapsed));
        };

        videoElement.addEventListener('loadedmetadata', resize);
        this.inferenceIntervals.set(senderId, { runner, listener: resize });
        loop();
    }

    updateOcrUI(predictions) {
        const ocrPanel = document.getElementById('ocrResultPanel');
        const ocrContent = document.getElementById('ocrResultContent');
        if (this.currentEngineType === 'ocr_gpu' && ocrPanel && ocrContent) {
            ocrPanel.classList.add('active');
            ocrContent.innerHTML = predictions.length > 0 ? predictions.map(p => 
                `<div class="ocr-line">${this.escapeHtml(p.class)}<span class="ocr-conf">(${(p.score * 100).toFixed(0)}%)</span></div>`
            ).join('') : 'テキストが検出されませんでした';
        } else if (ocrPanel) {
            ocrPanel.classList.remove('active');
        }
    }

    stopInferenceForVideo(senderId) {
        if (this.inferenceIntervals.has(senderId)) {
            const info = this.inferenceIntervals.get(senderId);
            if (info.runner) info.runner.active = false;
            this.inferenceIntervals.delete(senderId);
        }
    }

    sendInferenceResults(sourceId, predictions) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'inference_result', room_id: this.roomId, sender_id: this.connectionId, source_sender_id: sourceId, data: { timestamp: Date.now(), predictions } }));
        }
    }
}
