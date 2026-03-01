/**
 * Performance Tests for ws2infer-js
 * Tests inference performance, memory usage, and scalability
 */

// Performance monitoring utilities
class PerformanceMonitor {
    constructor() {
        this.metrics = {
            inferenceTimes: [],
            fps: [],
            memoryUsage: [],
            cpuUsage: [],
            networkLatency: []
        };
        this.startTime = performance.now();
    }

    startInferenceTimer() {
        this.inferenceStart = performance.now();
    }

    endInferenceTimer() {
        if (this.inferenceStart) {
            const duration = performance.now() - this.inferenceStart;
            this.metrics.inferenceTimes.push(duration);
            return duration;
        }
        return 0;
    }

    recordFPS() {
        const now = performance.now();
        if (this.lastFrameTime) {
            const fps = 1000 / (now - this.lastFrameTime);
            this.metrics.fps.push(fps);
        }
        this.lastFrameTime = now;
    }

    recordMemoryUsage() {
        if (performance.memory) {
            const memoryInfo = {
                used: performance.memory.usedJSHeapSize,
                total: performance.memory.totalJSHeapSize,
                limit: performance.memory.jsHeapSizeLimit
            };
            this.metrics.memoryUsage.push(memoryInfo);
        }
    }

    getAverageInferenceTime() {
        if (this.metrics.inferenceTimes.length === 0) return 0;
        const sum = this.metrics.inferenceTimes.reduce((a, b) => a + b, 0);
        return sum / this.metrics.inferenceTimes.length;
    }

    getAverageFPS() {
        if (this.metrics.fps.length === 0) return 0;
        const sum = this.metrics.fps.reduce((a, b) => a + b, 0);
        return sum / this.metrics.fps.length;
    }

    getMemoryTrend() {
        if (this.metrics.memoryUsage.length < 2) return 0;
        const first = this.metrics.memoryUsage[0].used;
        const last = this.metrics.memoryUsage[this.metrics.memoryUsage.length - 1].used;
        return last - first;
    }

    generateReport() {
        return {
            averageInferenceTime: this.getAverageInferenceTime(),
            averageFPS: this.getAverageFPS(),
            totalInferences: this.metrics.inferenceTimes.length,
            memoryTrend: this.getMemoryTrend(),
            peakMemory: Math.max(...this.metrics.memoryUsage.map(m => m.used)),
            testDuration: performance.now() - this.startTime
        };
    }
}

// Mock TensorFlow.js with performance tracking
class MockPerformanceModel {
    constructor(baseInferenceTime = 50, variance = 10) {
        this.baseInferenceTime = baseInferenceTime;
        this.variance = variance;
        this.inferenceCount = 0;
    }

    async detect(canvas) {
        this.inferenceCount++;
        
        // Simulate variable inference time
        const inferenceTime = this.baseInferenceTime + 
            (Math.random() - 0.5) * this.variance * 2;
        
        await new Promise(resolve => setTimeout(resolve, inferenceTime));
        
        // Generate realistic detection results
        const numDetections = Math.floor(Math.random() * 5) + 1;
        const detections = [];
        
        for (let i = 0; i < numDetections; i++) {
            detections.push({
                class: ['person', 'car', 'bicycle', 'dog', 'cat'][Math.floor(Math.random() * 5)],
                score: 0.5 + Math.random() * 0.5,
                bbox: [
                    Math.random() * 500,
                    Math.random() * 300,
                    50 + Math.random() * 100,
                    50 + Math.random() * 100
                ]
            });
        }
        
        return detections;
    }
}

// Performance test suite
class PerformanceTestSuite {
    constructor() {
        this.tests = [];
        this.results = [];
    }

    test(name, testFn) {
        this.tests.push({ name, testFn });
    }

    async run() {
        console.log('Running Performance Tests for ws2infer-js...\n');
        
        for (const test of this.tests) {
            console.log(`Running: ${test.name}`);
            const startTime = performance.now();
            
            try {
                const result = await test.testFn();
                const duration = performance.now() - startTime;
                
                console.log(`✓ ${test.name} (${duration.toFixed(2)}ms)`);
                this.results.push({
                    name: test.name,
                    status: 'passed',
                    duration,
                    result
                });
            } catch (error) {
                const duration = performance.now() - startTime;
                console.log(`✗ ${test.name} (${duration.toFixed(2)}ms)`);
                console.log(`  Error: ${error.message}`);
                this.results.push({
                    name: test.name,
                    status: 'failed',
                    duration,
                    error: error.message
                });
            }
        }
        
        this.generateSummary();
        return this.results;
    }

    generateSummary() {
        console.log('\n=== Performance Test Summary ===');
        
        const passed = this.results.filter(r => r.status === 'passed');
        const failed = this.results.filter(r => r.status === 'failed');
        
        console.log(`Total Tests: ${this.results.length}`);
        console.log(`Passed: ${passed.length}`);
        console.log(`Failed: ${failed.length}`);
        
        if (passed.length > 0) {
            const avgDuration = passed.reduce((sum, r) => sum + r.duration, 0) / passed.length;
            console.log(`Average Test Duration: ${avgDuration.toFixed(2)}ms`);
        }
        
        console.log('\nDetailed Results:');
        this.results.forEach(result => {
            const status = result.status === 'passed' ? '✓' : '✗';
            console.log(`${status} ${result.name}: ${result.duration.toFixed(2)}ms`);
            if (result.result) {
                console.log(`  Result: ${JSON.stringify(result.result, null, 2)}`);
            }
        });
    }
}

const perfSuite = new PerformanceTestSuite();

// Test 1: Inference Performance Baseline
perfSuite.test('Inference Performance Baseline', async () => {
    const monitor = new PerformanceMonitor();
    const model = new MockPerformanceModel(50, 5);
    const mockCanvas = { width: 640, height: 480 };
    
    // Run 100 inferences
    for (let i = 0; i < 100; i++) {
        monitor.startInferenceTimer();
        await model.detect(mockCanvas);
        monitor.endInferenceTimer();
        monitor.recordMemoryUsage();
        
        // Simulate frame rate
        await new Promise(resolve => setTimeout(resolve, 33)); // ~30 FPS
    }
    
    const report = monitor.generateReport();
    console.log(`Average Inference Time: ${report.averageInferenceTime.toFixed(2)}ms`);
    console.log(`Memory Trend: ${(report.memoryTrend / 1024 / 1024).toFixed(2)}MB`);
    
    // Performance assertions
    if (report.averageInferenceTime > 100) {
        throw new Error(`Average inference time too high: ${report.averageInferenceTime}ms`);
    }
    
    if (Math.abs(report.memoryTrend) > 50 * 1024 * 1024) { // 50MB
        throw new Error(`Memory leak detected: ${report.memoryTrend / 1024 / 1024}MB`);
    }
    
    return report;
});

// Test 2: High Frame Rate Performance
perfSuite.test('High Frame Rate Performance', async () => {
    const monitor = new PerformanceMonitor();
    const model = new MockPerformanceModel(30, 10); // Faster model
    const mockCanvas = { width: 640, height: 480 };
    
    const targetFPS = 60;
    const frameInterval = 1000 / targetFPS;
    let frameCount = 0;
    const testDuration = 5000; // 5 seconds
    const startTime = performance.now();
    
    while (performance.now() - startTime < testDuration) {
        const frameStart = performance.now();
        
        monitor.startInferenceTimer();
        const detections = await model.detect(mockCanvas);
        monitor.endInferenceTimer();
        
        monitor.recordFPS();
        monitor.recordMemoryUsage();
        
        frameCount++;
        
        // Maintain target frame rate
        const frameTime = performance.now() - frameStart;
        if (frameTime < frameInterval) {
            await new Promise(resolve => setTimeout(resolve, frameInterval - frameTime));
        }
    }
    
    const report = monitor.generateReport();
    const actualFPS = frameCount / (testDuration / 1000);
    
    console.log(`Target FPS: ${targetFPS}, Actual FPS: ${actualFPS.toFixed(2)}`);
    console.log(`Average Inference Time: ${report.averageInferenceTime.toFixed(2)}ms`);
    
    if (actualFPS < targetFPS * 0.8) { // Allow 20% tolerance
        throw new Error(`FPS too low: ${actualFPS} < ${targetFPS * 0.8}`);
    }
    
    return {
        targetFPS,
        actualFPS,
        averageInferenceTime: report.averageInferenceTime,
        frameCount
    };
});

// Test 3: Memory Stress Test
perfSuite.test('Memory Stress Test', async () => {
    const monitor = new PerformanceMonitor();
    const model = new MockPerformanceModel(40, 8);
    const mockCanvas = { width: 1280, height: 720 }; // Higher resolution
    
    // Simulate multiple concurrent inference sessions
    const sessions = [];
    const numSessions = 5;
    
    for (let session = 0; session < numSessions; session++) {
        sessions.push(async () => {
            const sessionResults = [];
            for (let i = 0; i < 50; i++) {
                monitor.startInferenceTimer();
                const detections = await model.detect(mockCanvas);
                const inferenceTime = monitor.endInferenceTimer();
                
                sessionResults.push({
                    sessionId: session,
                    frameId: i,
                    detections: detections.length,
                    inferenceTime
                });
                
                monitor.recordMemoryUsage();
                await new Promise(resolve => setTimeout(resolve, 20));
            }
            return sessionResults;
        });
    }
    
    // Run all sessions concurrently
    const results = await Promise.all(sessions.map(session => session()));
    
    const report = monitor.generateReport();
    console.log(`Total Inferences: ${results.reduce((sum, r) => sum + r.length, 0)}`);
    console.log(`Peak Memory: ${(report.peakMemory / 1024 / 1024).toFixed(2)}MB`);
    console.log(`Memory Trend: ${(report.memoryTrend / 1024 / 1024).toFixed(2)}MB`);
    
    // Check for memory leaks
    if (report.memoryTrend > 100 * 1024 * 1024) { // 100MB
        throw new Error(`Potential memory leak: ${report.memoryTrend / 1024 / 1024}MB increase`);
    }
    
    return {
        totalInferences: results.reduce((sum, r) => sum + r.length, 0),
        peakMemory: report.peakMemory,
        memoryTrend: report.memoryTrend,
        sessions: numSessions
    };
});

// Test 4: Scalability Test
perfSuite.test('Scalability Test', async () => {
    const monitor = new PerformanceMonitor();
    
    // Test with different numbers of concurrent clients
    const clientCounts = [1, 5, 10, 20];
    const scalabilityResults = [];
    
    for (const clientCount of clientCounts) {
        const model = new MockPerformanceModel(45, 12);
        const mockCanvas = { width: 640, height: 480 };
        
        const startTime = performance.now();
        
        // Simulate concurrent clients
        const clientTasks = [];
        for (let client = 0; client < clientCount; client++) {
            clientTasks.push(async () => {
                const clientResults = [];
                for (let frame = 0; frame < 20; frame++) {
                    monitor.startInferenceTimer();
                    const detections = await model.detect(mockCanvas);
                    const inferenceTime = monitor.endInferenceTimer();
                    
                    clientResults.push({
                        clientId: client,
                        frameId: frame,
                        detectionCount: detections.length,
                        inferenceTime
                    });
                    
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
                return clientResults;
            });
        }
        
        const clientResults = await Promise.all(clientTasks);
        const duration = performance.now() - startTime;
        
        const totalInferences = clientResults.reduce((sum, r) => sum + r.length, 0);
        const avgInferenceTime = clientResults.flat()
            .reduce((sum, r) => sum + r.inferenceTime, 0) / totalInferences;
        
        scalabilityResults.push({
            clientCount,
            totalInferences,
            avgInferenceTime,
            duration,
            throughput: totalInferences / (duration / 1000) // inferences per second
        });
        
        console.log(`  ${clientCount} clients: ${avgInferenceTime.toFixed(2)}ms avg, ${scalabilityResults[scalabilityResults.length - 1].throughput.toFixed(2)} inf/sec`);
    }
    
    // Check if performance degrades gracefully
    const firstResult = scalabilityResults[0];
    const lastResult = scalabilityResults[scalabilityResults.length - 1];
    const performanceDegradation = lastResult.avgInferenceTime / firstResult.avgInferenceTime;
    
    console.log(`Performance degradation factor: ${performanceDegradation.toFixed(2)}x`);
    
    if (performanceDegradation > 3) { // Allow 3x degradation
        throw new Error(`Performance degradation too high: ${performanceDegradation}x`);
    }
    
    return scalabilityResults;
});

// Test 5: Network Latency Impact
perfSuite.test('Network Latency Impact', async () => {
    const monitor = new PerformanceMonitor();
    const model = new MockPerformanceModel(35, 6);
    const mockCanvas = { width: 640, height: 480 };
    
    // Simulate different network conditions
    const latencyScenarios = [
        { name: 'Local', latency: 0, bandwidth: 1000 },
        { name: 'Fast Internet', latency: 50, bandwidth: 100 },
        { name: 'Slow Internet', latency: 200, bandwidth: 10 }
    ];
    
    const latencyResults = [];
    
    for (const scenario of latencyScenarios) {
        const startTime = performance.now();
        
        for (let i = 0; i < 30; i++) {
            // Simulate network latency
            if (scenario.latency > 0) {
                await new Promise(resolve => setTimeout(resolve, scenario.latency));
            }
            
            monitor.startInferenceTimer();
            const detections = await model.detect(mockCanvas);
            const inferenceTime = monitor.endInferenceTimer();
            
            // Simulate data transmission
            const dataSize = JSON.stringify(detections).length;
            const transmissionTime = (dataSize / 1024) / scenario.bandwidth * 1000;
            await new Promise(resolve => setTimeout(resolve, transmissionTime));
            
            monitor.recordMemoryUsage();
        }
        
        const totalDuration = performance.now() - startTime;
        const avgLatency = totalDuration / 30;
        
        latencyResults.push({
            scenario: scenario.name,
            avgLatency,
            totalDuration
        });
        
        console.log(`  ${scenario.name}: ${avgLatency.toFixed(2)}ms average`);
    }
    
    // Verify that latency increases with network degradation
    const localLatency = latencyResults[0].avgLatency;
    const slowLatency = latencyResults[2].avgLatency;
    
    if (slowLatency <= localLatency) {
        throw new Error('Network latency simulation not working correctly');
    }
    
    return latencyResults;
});

// Test 6: Long-running Stability Test
perfSuite.test('Long-running Stability Test', async () => {
    const monitor = new PerformanceMonitor();
    const model = new MockPerformanceModel(40, 15);
    const mockCanvas = { width: 640, height: 480 };
    
    const testDuration = 30000; // 30 seconds
    const startTime = performance.now();
    let frameCount = 0;
    let errorCount = 0;
    
    while (performance.now() - startTime < testDuration) {
        try {
            monitor.startInferenceTimer();
            const detections = await model.detect(mockCanvas);
            monitor.endInferenceTimer();
            
            monitor.recordFPS();
            monitor.recordMemoryUsage();
            
            frameCount++;
            
            // Randomly introduce some variability
            if (Math.random() < 0.05) { // 5% chance
                await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
            }
            
        } catch (error) {
            errorCount++;
            console.error(`Inference error: ${error.message}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 33)); // ~30 FPS
    }
    
    const report = monitor.generateReport();
    const actualDuration = performance.now() - startTime;
    const actualFPS = frameCount / (actualDuration / 1000);
    
    console.log(`Stability Test Results:`);
    console.log(`  Duration: ${(actualDuration / 1000).toFixed(2)}s`);
    console.log(`  Frames processed: ${frameCount}`);
    console.log(`  Average FPS: ${actualFPS.toFixed(2)}`);
    console.log(`  Errors: ${errorCount}`);
    console.log(`  Average inference time: ${report.averageInferenceTime.toFixed(2)}ms`);
    console.log(`  Memory trend: ${(report.memoryTrend / 1024 / 1024).toFixed(2)}MB`);
    
    // Stability assertions
    if (errorCount > frameCount * 0.01) { // Allow 1% error rate
        throw new Error(`Error rate too high: ${errorCount}/${frameCount}`);
    }
    
    if (Math.abs(report.memoryTrend) > 200 * 1024 * 1024) { // 200MB
        throw new Error(`Memory instability: ${report.memoryTrend / 1024 / 1024}MB`);
    }
    
    return {
        duration: actualDuration,
        frameCount,
        averageFPS: actualFPS,
        errorCount,
        averageInferenceTime: report.averageInferenceTime,
        memoryTrend: report.memoryTrend
    };
});

// Export for Node.js environment
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PerformanceTestSuite, perfSuite, PerformanceMonitor };
}

// Auto-run in browser environment
if (typeof window !== 'undefined') {
    window.runPerformanceTests = async () => {
        return await perfSuite.run();
    };
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            console.log('Performance tests loaded. Run window.runPerformanceTests() to execute.');
        });
    }
}
