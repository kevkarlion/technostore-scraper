// Public surface of the monitoring module.
// Health-checker and metrics-aggregator land in PR 2 (Phase 2 tasks 2.3 / 2.4).

export { createExecutionRecorder } from './execution-recorder';
export * from './types';

import type { MonitoringConfig } from './types';

/**
 * Create the three monitoring collections and their indexes.
 * Safe to call multiple times — Mongo `createIndex` is idempotent.
 *
 * TTL retention:
 *   - execution_logs:    90 days
 *   - health_checks:     180 days
 *   - metrics_snapshots: 365 days
 */
export async function initMonitoring(config: MonitoringConfig): Promise<void> {
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
