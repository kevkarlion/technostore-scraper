import type { MonitoringConfig, MetricsSnapshot } from './types';

/**
 * Daily metrics aggregator.
 *
 * Computes a one-document-per-day snapshot of the scraper's behavior and
 * upserts it into `metrics_snapshots`. The dashboard's GET /metrics reads
 * ONLY from this collection (never raw-scans execution_logs at request
 * time — see spec R5.5).
 *
 * Idempotent design: aggregateToday() can be called as often as desired.
 * The `date: YYYY-MM-DD` unique index guarantees a single document per
 * day, and \$set replaces the full snapshot with the current totals.
 *
 * Default aggregation cadence is hourly (startPeriodicAggregation(1h)),
 * but each call only re-runs a single \$match +\$group pipeline over
 * today's execution_logs — cheap on M0 even at 1h intervals.
 */
export function createMetricsAggregator(config: MonitoringConfig) {
  const db = config.db;
  const execCollection = db.collection(config.collectionNames?.executionLogs || 'execution_logs');
  const metricsCollection = db.collection(config.collectionNames?.metricsSnapshots || 'metrics_snapshots');

  /**
   * Aggregate today's metrics and upsert the snapshot.
   * Returns the snapshot, or null on failure.
   */
  async function aggregateToday(): Promise<MetricsSnapshot | null> {
    try {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

      const dateStr = today.toISOString().split('T')[0]; // YYYY-MM-DD

      const pipeline = [
        {
          $match: {
            startedAt: { $gte: today, $lt: tomorrow },
          },
        },
        {
          $group: {
            _id: null,
            totalRuns: { $sum: 1 },
            successCount: { $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] } },
            warningCount: { $sum: { $cond: [{ $eq: ['$status', 'warning'] }, 1, 0] } },
            errorCount: { $sum: { $cond: [{ $eq: ['$status', 'error'] }, 1, 0] } },
            avgDurationMs: { $avg: '$durationMs' },
            maxDurationMs: { $max: '$durationMs' },
            minDurationMs: { $min: '$durationMs' },
            totalProductsFound: { $sum: { $ifNull: ['$productsFound', 0] } },
            totalProductsCreated: { $sum: { $ifNull: ['$productsCreated', 0] } },
            totalProductsUpdated: { $sum: { $ifNull: ['$productsUpdated', 0] } },
            totalProductsUnavailable: { $sum: { $ifNull: ['$productsUnavailable', 0] } },
          },
        },
      ];

      const results = await execCollection.aggregate(pipeline).toArray() as Array<{
        totalRuns: number;
        successCount: number;
        warningCount: number;
        errorCount: number;
        avgDurationMs: number | null;
        maxDurationMs: number | null;
        minDurationMs: number | null;
        totalProductsFound: number;
        totalProductsCreated: number;
        totalProductsUpdated: number;
        totalProductsUnavailable: number;
      }>;

      // Empty day — write a zero snapshot so GET /metrics can still render
      // the day on the trend chart instead of skipping it.
      if (results.length === 0) {
        const emptySnapshot: MetricsSnapshot = {
          date: dateStr,
          totalRuns: 0,
          successCount: 0,
          warningCount: 0,
          errorCount: 0,
          avgDurationMs: 0,
          maxDurationMs: 0,
          minDurationMs: 0,
          totalProductsFound: 0,
          totalProductsCreated: 0,
          totalProductsUpdated: 0,
          totalProductsUnavailable: 0,
          avgProductsFound: 0,
          avgProductsUpdated: 0,
        };
        await metricsCollection.updateOne(
          { date: dateStr },
          { $set: emptySnapshot },
          { upsert: true }
        );
        return emptySnapshot;
      }

      const r = results[0];
      const snapshot: MetricsSnapshot = {
        date: dateStr,
        totalRuns: r.totalRuns,
        successCount: r.successCount,
        warningCount: r.warningCount,
        errorCount: r.errorCount,
        avgDurationMs: Math.round(r.avgDurationMs || 0),
        maxDurationMs: r.maxDurationMs || 0,
        minDurationMs: r.minDurationMs || 0,
        totalProductsFound: r.totalProductsFound,
        totalProductsCreated: r.totalProductsCreated,
        totalProductsUpdated: r.totalProductsUpdated,
        totalProductsUnavailable: r.totalProductsUnavailable,
        avgProductsFound: r.totalRuns > 0 ? Math.round(r.totalProductsFound / r.totalRuns) : 0,
        avgProductsUpdated: r.totalRuns > 0 ? Math.round(r.totalProductsUpdated / r.totalRuns) : 0,
      };

      await metricsCollection.updateOne(
        { date: dateStr },
        { $set: snapshot },
        { upsert: true }
      );

      return snapshot;
    } catch (e) {
      console.error('[MetricsAggregator] Error aggregating today:', e);
      return null;
    }
  }

  /**
   * Get metrics snapshots for the last N days, newest first.
   */
  async function getMetrics(days: number = 7): Promise<MetricsSnapshot[]> {
    try {
      const since = new Date();
      since.setUTCDate(since.getUTCDate() - days);
      const sinceStr = since.toISOString().split('T')[0];

      return await metricsCollection.find(
        { date: { $gte: sinceStr } },
        { sort: { date: -1 } }
      ).toArray() as MetricsSnapshot[];
    } catch {
      return [];
    }
  }

  /**
   * Run aggregateToday() immediately, then every `intervalMs` (default 1h).
   * Returns the interval handle so the caller can clear it on shutdown.
   */
  function startPeriodicAggregation(intervalMs: number = 60 * 60 * 1000): NodeJS.Timeout {
    aggregateToday().catch(e => console.error('[Metrics] Initial aggregation failed:', e));

    const handle = setInterval(() => {
      aggregateToday().catch(e => console.error('[Metrics] Periodic aggregation failed:', e));
    }, intervalMs);

    return handle;
  }

  return { aggregateToday, getMetrics, startPeriodicAggregation };
}
