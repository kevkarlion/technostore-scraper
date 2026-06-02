"use strict";
// Public surface of the monitoring module.
// All three sidecar pieces (recorder, health-checker, metrics-aggregator)
// are exported here. The HTTP API router and dashboard land in PR 3.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSSEEmitter = exports.createMetricsAggregator = exports.createHealthChecker = exports.createExecutionRecorder = void 0;
exports.initMonitoring = initMonitoring;
var execution_recorder_1 = require("./execution-recorder");
Object.defineProperty(exports, "createExecutionRecorder", { enumerable: true, get: function () { return execution_recorder_1.createExecutionRecorder; } });
var health_checker_1 = require("./health-checker");
Object.defineProperty(exports, "createHealthChecker", { enumerable: true, get: function () { return health_checker_1.createHealthChecker; } });
var metrics_aggregator_1 = require("./metrics-aggregator");
Object.defineProperty(exports, "createMetricsAggregator", { enumerable: true, get: function () { return metrics_aggregator_1.createMetricsAggregator; } });
var sse_emitter_1 = require("./sse-emitter");
Object.defineProperty(exports, "createSSEEmitter", { enumerable: true, get: function () { return sse_emitter_1.createSSEEmitter; } });
__exportStar(require("./types"), exports);
/**
 * Create the three monitoring collections and their indexes.
 * Safe to call multiple times — Mongo `createIndex` is idempotent.
 *
 * TTL retention:
 *   - execution_logs:    90 days
 *   - health_checks:     180 days
 *   - metrics_snapshots: 365 days
 */
async function initMonitoring(config) {
    const { db, collectionNames = {} } = config;
    const executionLogs = db.collection(collectionNames.executionLogs || 'execution_logs');
    const healthChecks = db.collection(collectionNames.healthChecks || 'health_checks');
    const metricsSnapshots = db.collection(collectionNames.metricsSnapshots || 'metrics_snapshots');
    // execution_logs: time-range + status queries
    await executionLogs.createIndex({ startedAt: -1 });
    await executionLogs.createIndex({ status: 1, startedAt: -1 });
    // TTL: auto-delete after 90 days
    await executionLogs.createIndex({ startedAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
    // health_checks: time-range + unresolved-anomaly queries
    await healthChecks.createIndex({ detectedAt: -1 });
    await healthChecks.createIndex({ checkType: 1, detectedAt: -1 });
    await healthChecks.createIndex({ severity: 1, resolvedAt: 1 });
    // TTL: 180 days
    await healthChecks.createIndex({ detectedAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });
    // metrics_snapshots: one doc per date
    await metricsSnapshots.createIndex({ date: -1 }, { unique: true });
    // TTL: 365 days
    await metricsSnapshots.createIndex({ date: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });
    console.log('[Monitoring] Indexes created. Collections: execution_logs, health_checks, metrics_snapshots');
}
