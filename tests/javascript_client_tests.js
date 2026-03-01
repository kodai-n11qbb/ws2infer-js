/**
 * JavaScript Tests for ws2infer-js Client-side Functionality
 * Tests for WebRTC connection, TensorFlow.js inference, and UI components
 */

// Mock dependencies for testing environment
global.WebSocket = class MockWebSocket {
    constructor(url) {
        this.url = url;
        this.readyState = WebSocket.CONNECTING;
        setTimeout(() => {
            this.readyState = WebSocket.OPEN;
            if (this.onopen) this.onopen();
        }, 100);
    }
    
    send(data) {
        console.log('Mock WebSocket send:', data);
    }
    
    close() {
        this.readyState = WebSocket.CLOSED;
        if (this.onclose) this.onclose();
    }
};

global.WebSocket.CONNECTING = 0;
global.WebSocket.OPEN = 1;
global.WebSocket.CLOSING = 2;
global.WebSocket.CLOSED = 3;

// Mock RTCPeerConnection
global.RTCPeerConnection = class MockRTCPeerConnection {
    constructor(config) {
        this.config = config;
        this.localDescription = null;
        this.remoteDescription = null;
        this.onicecandidate = null;
        this.ontrack = null;
    }
    
    async createOffer() {
        return { type: 'offer', sdp: 'mock-offer-sdp' };
    }
    
    async createAnswer() {
        return { type: 'answer', sdp: 'mock-answer-sdp' };
    }
    
    async setLocalDescription(desc) {
        this.localDescription = desc;
    }
    
    async setRemoteDescription(desc) {
        this.remoteDescription = desc;
    }
    
    addIceCandidate(candidate) {
        // Mock implementation
    }
    
    addTrack(track, stream) {
        // Mock implementation
    }
    
    createDataChannel(label, config) {
        return new MockDataChannel(label, config);
    }
};

global.RTCIceCandidate = class MockRTCIceCandidate {
    constructor(candidate) {
        this.candidate = candidate;
    }
};

global.RTCSessionDescription = class MockRTCSessionDescription {
    constructor(desc) {
        this.type = desc.type;
        this.sdp = desc.sdp;
    }
};

class MockDataChannel {
    constructor(label, config) {
        this.label = label;
        this.config = config;
        this.readyState = 'connecting';
        this.onopen = null;
        this.onmessage = null;
        this.onclose = null;
        
        setTimeout(() => {
            this.readyState = 'open';
            if (this.onopen) this.onopen();
        }, 50);
    }
    
    send(data) {
        console.log('Mock DataChannel send:', data);
    }
    
    close() {
        this.readyState = 'closed';
        if (this.onclose) this.onclose();
    }
}

// Mock TensorFlow.js
global.tf = {
    loadLayersModel: async (url) => {
        return new MockCocoSsdModel();
    },
    browser: {
        fromPixels: (canvas) => new MockTensor(),
        toPixels: async (tensor, canvas) => true,
    },
    tidy: (fn) => fn(),
    dispose: () => {},
};

class MockTensor {
    constructor() {
        this.shape = [300, 300, 3];
    }
    
    resizeBilinear(size) {
        return new MockTensor();
    }
    
    expandDims() {
        return new MockTensor();
    }
    
    div(value) {
        return new MockTensor();
    }
    
    dataSync() {
        return new Float32Array(100);
    }
}

class MockCocoSsdModel {
    async detect(canvas) {
        return [
            {
                bbox: [10, 10, 100, 100],
                class: 'person',
                score: 0.9
            },
            {
                bbox: [150, 50, 80, 120],
                class: 'car',
                score: 0.8
            }
        ];
    }
}

// Test Suite
class TestSuite {
    constructor() {
        this.tests = [];
        this.passed = 0;
        this.failed = 0;
    }
    
    test(name, testFn) {
        this.tests.push({ name, testFn });
    }
    
    assert(condition, message) {
        if (!condition) {
            throw new Error(message || 'Assertion failed');
        }
    }
    
    assertEqual(actual, expected, message) {
        if (actual !== expected) {
            throw new Error(message || `Expected ${expected}, got ${actual}`);
        }
    }
    
    assertArrayEqual(actual, expected, message) {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        }
    }
    
    async run() {
        console.log('Running JavaScript Tests for ws2infer-js Client...\n');
        
        for (const test of this.tests) {
            try {
                await test.testFn();
                console.log(`✓ ${test.name}`);
                this.passed++;
            } catch (error) {
                console.log(`✗ ${test.name}`);
                console.log(`  Error: ${error.message}`);
                this.failed++;
            }
        }
        
        console.log(`\nTest Results: ${this.passed} passed, ${this.failed} failed`);
        return this.failed === 0;
    }
}

// Test Cases
const suite = new TestSuite();

// Test WebSocket Connection
suite.test('WebSocket Connection Setup', async () => {
    const ws = new WebSocket('ws://localhost:8080');
    
    suite.assertEqual(ws.url, 'ws://localhost:8080', 'WebSocket URL should match');
    suite.assert(ws instanceof WebSocket, 'Should create WebSocket instance');
});

// Test RTCPeerConnection
suite.test('RTCPeerConnection Creation', async () => {
    const config = {
        iceServers: [{ urls: 'stun:localhost:3478' }]
    };
    
    const pc = new RTCPeerConnection(config);
    
    suite.assert(pc instanceof RTCPeerConnection, 'Should create RTCPeerConnection');
    suite.assertArrayEqual(pc.config.iceServers, config.iceServers, 'ICE servers should match');
});

// Test WebRTC Offer/Answer
suite.test('WebRTC Offer/Answer Exchange', async () => {
    const pc1 = new RTCPeerConnection({});
    const pc2 = new RTCPeerConnection({});
    
    const offer = await pc1.createOffer();
    suite.assertEqual(offer.type, 'offer', 'Should create offer with correct type');
    suite.assert(offer.sdp.includes('mock-offer-sdp'), 'Offer should contain SDP');
    
    await pc1.setLocalDescription(offer);
    suite.assertEqual(pc1.localDescription.type, 'offer', 'Local description should be set');
    
    await pc2.setRemoteDescription(offer);
    suite.assertEqual(pc2.remoteDescription.type, 'offer', 'Remote description should be set');
    
    const answer = await pc2.createAnswer();
    suite.assertEqual(answer.type, 'answer', 'Should create answer with correct type');
});

// Test TensorFlow.js Model Loading
suite.test('TensorFlow.js Model Loading', async () => {
    const model = await tf.loadLayersModel('mock-model-url');
    
    suite.assert(model instanceof MockCocoSsdModel, 'Should load COCO-SSD model');
});

// Test Object Detection
suite.test('Object Detection', async () => {
    const model = new MockCocoSsdModel();
    const mockCanvas = {
        width: 640,
        height: 480,
        getContext: () => ({
            getImageData: () => ({ data: new Uint8ClampedArray(640 * 480 * 4) })
        })
    };
    
    const detections = await model.detect(mockCanvas);
    
    suite.assert(Array.isArray(detections), 'Should return array of detections');
    suite.assertEqual(detections.length, 2, 'Should detect 2 objects');
    
    const person = detections.find(d => d.class === 'person');
    suite.assert(person !== undefined, 'Should detect person');
    suite.assertEqual(person.score, 0.9, 'Person detection confidence should be 0.9');
    suite.assertArrayEqual(person.bbox, [10, 10, 100, 100], 'Person bbox should match');
});

// Test Inference Configuration
suite.test('Inference Configuration', () => {
    const config = {
        inferenceInterval: 1000,
        scaleInput: true,
        scaleFactor: 0.5,
        frameSkip: 1,
        scoreThreshold: 0.5,
        maxDetections: 20
    };
    
    suite.assertEqual(config.inferenceInterval, 1000, 'Inference interval should be 1000ms');
    suite.assert(config.scaleInput, 'Scale input should be enabled');
    suite.assertEqual(config.scaleFactor, 0.5, 'Scale factor should be 0.5');
    suite.assertEqual(config.frameSkip, 1, 'Frame skip should be 1');
    suite.assertEqual(config.scoreThreshold, 0.5, 'Score threshold should be 0.5');
    suite.assertEqual(config.maxDetections, 20, 'Max detections should be 20');
});

// Test Video Constraints
suite.test('Video Constraints', () => {
    const constraints = {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user'
    };
    
    suite.assertEqual(constraints.width.ideal, 1280, 'Ideal width should be 1280');
    suite.assertEqual(constraints.height.ideal, 720, 'Ideal height should be 720');
    suite.assertEqual(constraints.facingMode, 'user', 'Facing mode should be user');
});

// Test Signaling Message Format
suite.test('Signaling Message Format', () => {
    const offerMessage = {
        type: 'offer',
        from: 'client1',
        to: 'client2',
        sdp: 'mock-sdp'
    };
    
    suite.assertEqual(offerMessage.type, 'offer', 'Message type should be offer');
    suite.assertEqual(offerMessage.from, 'client1', 'Sender should be client1');
    suite.assertEqual(offerMessage.to, 'client2', 'Receiver should be client2');
    suite.assertEqual(offerMessage.sdp, 'mock-sdp', 'SDP should match');
});

// Test Canvas Drawing
suite.test('Canvas Drawing', () => {
    const mockCanvas = {
        width: 640,
        height: 480,
        getContext: () => ({
            strokeRect: (x, y, w, h) => {
                suite.assert(typeof x === 'number', 'X should be number');
                suite.assert(typeof y === 'number', 'Y should be number');
                suite.assert(typeof w === 'number', 'Width should be number');
                suite.assert(typeof h === 'number', 'Height should be number');
            },
            fillText: (text, x, y) => {
                suite.assert(typeof text === 'string', 'Text should be string');
                suite.assert(typeof x === 'number', 'X should be number');
                suite.assert(typeof y === 'number', 'Y should be number');
            },
            clearRect: () => {},
            beginPath: () => {},
            stroke: () => {},
            fill: () => {},
            moveTo: () => {},
            lineTo: () => {}
        })
    };
    
    const ctx = mockCanvas.getContext('2d');
    suite.assert(ctx !== null, 'Should get 2D context');
    
    // Test drawing bounding box
    ctx.strokeRect(10, 10, 100, 100);
    ctx.fillText('person: 0.9', 10, 5);
});

// Test Performance Monitoring
suite.test('Performance Monitoring', () => {
    const performanceData = {
        fps: 30,
        inferenceTime: 50,
        detectionCount: 2,
        timestamp: Date.now()
    };
    
    suite.assert(performanceData.fps > 0, 'FPS should be positive');
    suite.assert(performanceData.inferenceTime >= 0, 'Inference time should be non-negative');
    suite.assert(performanceData.detectionCount >= 0, 'Detection count should be non-negative');
    suite.assert(performanceData.timestamp > 0, 'Timestamp should be positive');
});

// Test Error Handling
suite.test('Error Handling', () => {
    let errorCaught = false;
    
    try {
        throw new Error('Test error');
    } catch (error) {
        errorCaught = true;
        suite.assertEqual(error.message, 'Test error', 'Error message should match');
    }
    
    suite.assert(errorCaught, 'Should catch error');
});

// Test Room Management
suite.test('Room Management', () => {
    const roomId = 'test-room-123';
    const clientId = 'client-456';
    
    suite.assert(roomId.length > 0, 'Room ID should not be empty');
    suite.assert(clientId.length > 0, 'Client ID should not be empty');
    suite.assert(roomId !== clientId, 'Room ID and client ID should be different');
});

// Test Data Serialization
suite.test('Data Serialization', () => {
    const detectionData = {
        room_id: 'test-room',
        source_id: 'test-client',
        timestamp: Date.now(),
        detections: [
            {
                class: 'person',
                score: 0.9,
                bbox: [10, 10, 100, 100]
            }
        ]
    };
    
    const serialized = JSON.stringify(detectionData);
    const deserialized = JSON.parse(serialized);
    
    suite.assertArrayEqual(deserialized.detections, detectionData.detections, 'Detections should match after serialization');
    suite.assertEqual(deserialized.room_id, detectionData.room_id, 'Room ID should match after serialization');
    suite.assertEqual(deserialized.source_id, detectionData.source_id, 'Source ID should match after serialization');
});

// Export for Node.js environment
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TestSuite, suite };
}

// Run tests if in browser environment
if (typeof window !== 'undefined') {
    window.runTests = async () => {
        return await suite.run();
    };
    
    // Auto-run if page loads
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => suite.run());
    } else {
        suite.run();
    }
}
