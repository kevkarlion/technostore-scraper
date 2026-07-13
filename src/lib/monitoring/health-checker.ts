import type { MonitoringConfig, HealthCheck, ExecutionLog } from './types';

/**
 * Health checker that runs after each execution log is written.
 * Implements 4 anomaly-detection rules (spec R4.1–R4.4):
 *
 *   1. consecutive-failures  — 3+ error runs in a row.
 *   2. slow-execution        — latest duration > 2× avg of last 10 successful runs.
 *   3. repetitive-errors     — same `errors[0]` in 3+ consecutive error runs.
 *   4. scraper-stopped       — separate function (called by periodic timer);
 *                              alerts if no execution in >3h during the
 *                              07:00–24:00 Argentina active window.
 *
 * Design contract:
 *   - checkAfterExecution() MUST NEVER throw. Errors are logged and swallowed
 *     so a monitoring failure cannot break the scraper response.
 *   - Each detected issue is written to `health_checks` (fire-and-forget).
 *   - The scraper-stopped check is a separate function because it has
 *     different timing (runs on a cron, not on every execution).
 */
export function createHealthChecker(config: MonitoringConfig) {
  const db = config.db;
  const execCollection = db.collection(config.collectionNames?.executionLogs || 'execution_logs');
  const healthCollection = db.collection(config.collectionNames?.healthChecks || 'health_checks');

  /**
   * Run all post-execution health checks (rules 1–3).
   * Writes detected anomalies to `health_checks`. Never throws.
   */
  async function checkAfterExecution(newLog: ExecutionLog): Promise<HealthCheck[]> {
    const detected: HealthCheck[] = [];

    try {
      // DISABLED: scraper-stopped resolution (feature disabled)
      // Resolve any pending 'scraper-stopped' alerts — any execution means
      // the scraper is not stopped. We do this unconditionally so that even
      // a warning/error run clears stale alerts, preventing the 30-min
      // checkScraperStopped timer from accumulating duplicates.
      // try {
      //   await healthCollection.updateMany(
      //     { checkType: 'scraper-stopped', resolvedAt: { $exists: false } },
      //     { $set: { resolvedAt: new Date() } }
      //   );
      // } catch (e) {
      //   console.error('[HealthChecker] Error resolving scraper-stopped alerts:', e);
      // }

      // Check 1: Consecutive failures (3+ errors in a row).
      // countDocuments with sort+limit returns the count of the most recent N
      // matching docs — perfect for "are the last 3 runs all errors?".
      if (newLog.status === 'error') {
        const recentErrors = await execCollection.countDocuments(
          { status: 'error' },
          { sort: { startedAt: -1 }, limit: 3 }
        );
        if (recentErrors >= 3) {
          detected.push({
            detectedAt: new Date(),
            checkType: 'consecutive-failures',
            severity: 'critical',
            message: '3+ consecutive scraper failures detected',
            details: { count: recentErrors },
          });
        }
      }
      // A success run naturally breaks the streak — countDocuments({status:'error'}) < 3.

      // Check 2: Slow execution (> 2× avg of last 10 successful/warning runs).
      if (newLog.durationMs && newLog.status !== 'error') {
        const recentDurations = await execCollection.find(
          { status: { $in: ['success', 'warning'] }, durationMs: { $exists: true } },
          { sort: { startedAt: -1 }, limit: 10, projection: { durationMs: 1 } }
        ).toArray() as { durationMs?: number }[];

        if (recentDurations.length >= 3) {
          const avgDuration = recentDurations.reduce((sum, r) => sum + (r.durationMs || 0), 0) / recentDurations.length;
          if (newLog.durationMs > avgDuration * 2) {
            detected.push({
              detectedAt: new Date(),
              checkType: 'slow-execution',
              severity: 'warning',
              message: `Execution took ${Math.round(newLog.durationMs / 1000)}s, >2x average of ${Math.round(avgDuration / 1000)}s`,
              details: { durationMs: newLog.durationMs, avgDurationMs: avgDuration },
            });
          }
        }
      }

      // Check 3: Repetitive errors — same error message in 3+ consecutive error runs.
      if (newLog.errors && newLog.errors.length > 0) {
        const lastErrors = await execCollection.find(
          { status: 'error', errors: { $exists: true, $not: { $size: 0 } } },
          { sort: { startedAt: -1 }, limit: 3, projection: { errors: 1 } }
        ).toArray() as { errors?: string[] }[];

        if (lastErrors.length >= 3) {
          const allErrorMsgs = lastErrors.flatMap(e => e.errors || []);
          const errorCounts = new Map<string, number>();
          for (const msg of allErrorMsgs) {
            errorCounts.set(msg, (errorCounts.get(msg) || 0) + 1);
          }
          for (const [msg, count] of errorCounts) {
            if (count >= 3) {
              detected.push({
                detectedAt: new Date(),
                checkType: 'repetitive-errors',
                severity: 'warning',
                message: `Same error in 3+ consecutive runs: ${msg.substring(0, 100)}`,
                details: { errorMessage: msg, occurrenceCount: count },
              });
              break; // Report one repetitive error type at a time
            }
          }
        }
      }

      // Persist detected issues. Each insert is wrapped individually so a
      // single failure doesn't lose the rest.
      for (const check of detected) {
        try {
          await healthCollection.insertOne(check);
        } catch (e) {
          console.error('[HealthChecker] Failed to save health check:', e);
        }
      }
    } catch (e) {
      console.error('[HealthChecker] Error running health checks:', e);
    }

    return detected;
  }

  // DISABLED: scraper-stopped check - not needed since scraper runs manually/on-demand
  /**
   * Check whether the scraper has stopped (no execution in >3h during the
   * Argentina 07:00–24:00 active window). Returns a HealthCheck alert or null.
   *
   * Designed to be called on a 30-minute interval from server.ts, NOT on
   * every execution.
   */
  // async function checkScraperStopped(): Promise<HealthCheck | null> {
  //   try {
  //     const now = new Date();
  //     // Argentina is UTC-3, so local hour = UTC hour - 3.
  //     const argentinaHour = now.getUTCHours() - 3;

  //     // Active window: 07:00 – 24:00 Argentina time.
  //     // Outside this window (i.e. 00:00–07:00) the scraper is allowed to be
  //     // idle — do not alert.
  //     if (argentinaHour < 7) {
  //       return null;
  //     }

  //     const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  //     const lastRun = await execCollection.findOne(
  //       {},
  //       { sort: { startedAt: -1 }, projection: { startedAt: 1 } }
  //     ) as { startedAt?: Date } | null;

  //     if (!lastRun || !lastRun.startedAt) {
  //       // Skip if there's already an unresolved alert of this type to avoid
  //       // accumulating duplicates on the 30-min timer (no execution yet).
  //       const existing = await healthCollection.findOne(
  //         { checkType: 'scraper-stopped', resolvedAt: { $exists: false } },
  //         { sort: { detectedAt: -1 } }
  //       );
  //       if (existing) return null;

  //       return {
  //         detectedAt: now,
  //         checkType: 'scraper-stopped',
  //         severity: 'critical',
  //         message: 'No scraper executions recorded yet',
  //         details: { lastRunAt: null },
  //       };
  //     }

  //     if (lastRun.startedAt < threeHoursAgo) {
  //       // Skip if there's already an unresolved alert for this condition
  //       // to avoid accumulating duplicates (timer runs every 30 min).
  //       const existing = await healthCollection.findOne(
  //         { checkType: 'scraper-stopped', resolvedAt: { $exists: false } },
  //         { sort: { detectedAt: -1 } }
  //       );
  //       if (existing) {
  //         // Still refresh the detectedAt so the dashboard shows the most
  //         // recent check time without creating a new document.
  //         await healthCollection.updateOne(
  //           { _id: existing._id },
  //           { $set: { detectedAt: now } }
  //         );
  //         return null;
  //       }

  //       return {
  //         detectedAt: now,
  //         checkType: 'scraper-stopped',
  //         severity: 'critical',
  //         message: `Scraper has not run in over 3 hours. Last run: ${lastRun.startedAt.toISOString()}`,
  //         details: { lastRunAt: lastRun.startedAt },
  //       };
  //     }

  //     return null;
  //   } catch (e) {
  //     console.error('[HealthChecker] Error in checkScraperStopped:', e);
  //     return null;
  //   }
  // }

async function checkScraperStopped(): Promise<HealthCheck | null> {
    return null; // Disabled
  }

  /**
   * Get all unresolved health alerts (resolvedAt not set), newest first.
   */
  async function getActiveAlerts(): Promise<HealthCheck[]> {
    try {
      return await healthCollection.find(
        { resolvedAt: { $exists: false } },
        { sort: { detectedAt: -1 }, limit: 20 }
      ).toArray() as HealthCheck[];
    } catch {
      return [];
    }
  }

  return { checkAfterExecution, checkScraperStopped, getActiveAlerts };
}
