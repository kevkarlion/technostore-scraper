// Monitoring module — domain types for execution logs, health checks,
// and pre-aggregated metrics snapshots. All types are plain TS interfaces;
// the MongoDB driver returns plain objects (no Mongoose in this project).

// One document per scraper run (cron, http, or manual trigger)
export interface ExecutionLog {
  startedAt: Date;
  completedAt?: Date;
  durationMs?: number;
  status: 'success' | 'warning' | 'error';
  triggerSource: 'cron' | 'http' | 'manual';
  productsFound: number;
  productsCreated: number;
  productsUpdated: number;
  productsUnavailable: number;  // products marked inStock:false
  categoriesScraped: string[];
  errorCount: number;
  errors: string[];
  logEntries: string[];
  metadata?: {
    commitSha?: string;
    environment?: string;
    durationCategory?: 'fast' | 'normal' | 'slow' | 'error';
  };
}

// One document per detected anomaly
export interface HealthCheck {
  detectedAt: Date;
  checkType: 'scraper-stopped' | 'consecutive-failures' | 'product-drop' | 'slow-execution' | 'repetitive-errors';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  details?: Record<string, unknown>;
  resolvedAt?: Date;
  resolvedBy?: string;
}

// One document per day with pre-aggregated stats for trend charts
export interface MetricsSnapshot {
  date: string;  // YYYY-MM-DD
  totalRuns: number;
  successCount: number;
  warningCount: number;
  errorCount: number;
  avgDurationMs: number;
  maxDurationMs: number;
  minDurationMs: number;
  totalProductsFound: number;
  totalProductsCreated: number;
  totalProductsUpdated: number;
  totalProductsUnavailable: number;
  avgProductsFound: number;
  avgProductsUpdated: number;
}

// Factory config — pass a Mongo `Db` instance and optional collection overrides
export interface MonitoringConfig {
  db: any; // MongoDB Db instance
  collectionNames?: {
    executionLogs?: string;
    healthChecks?: string;
    metricsSnapshots?: string;
  };
}

// Aggregated status returned by the dashboard overview endpoint
export interface DashboardStatus {
  scraperStatus: 'running' | 'idle' | 'stopped' | 'error';
  lastExecution: ExecutionLog | null;
  lastExecutionTimeAgo: string | null;
  avgDurationLast7Days: number;
  totalProductsFound: number;
  totalProductsUpdated: number;
  errorsLast24h: number;
  successRateLast7Days: number;
}
