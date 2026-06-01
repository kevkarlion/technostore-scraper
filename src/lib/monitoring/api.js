"use strict";
// Express router for the monitoring dashboard API.
// All endpoints are read-only against the three monitoring collections
// (execution_logs, health_checks, metrics_snapshots) — never aggregate
// raw logs at request time per spec R5.5.
//
// Endpoints mounted under /api/monitoring/ by server.ts:
//   GET  /status        — current scraper state + 7-day summary (R2.1)
//   GET  /history       — paginated execution log, filters: from/to/status (R2.2)
//   GET  /executions/:id — full run detail incl. logs (R2.3)
//   GET  /metrics       — pre-aggregated snapshots + summary (R2.4)
//   GET  /health        — active health alerts (R2.5)
//   POST /health/check  — manually trigger the scraper-stopped check
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMonitoringRouter = createMonitoringRouter;
const mongodb_1 = require("mongodb");
function createMonitoringRouter(config, healthChecker, metricsAggregator) {
    const router = require('express').Router();
    const db = config.db;
    const execCollection = db.collection(config.collectionNames?.executionLogs || 'execution_logs');
    const healthCollection = db.collection(config.collectionNames?.healthChecks || 'health_checks');
    const metricsCollection = db.collection(config.collectionNames?.metricsSnapshots || 'metrics_snapshots');
    /**
     * Compute the Argentina local hour from a UTC Date.
     * Argentina is UTC-3 year-round (no DST).
     */
    function argentinaHourOf(d) {
        return d.getUTCHours() - 3;
    }
    /**
     * GET /status — current scraper state + 7-day overview stats.
     */
    router.get('/status', async (req, res) => {
        try {
            const lastExecution = await execCollection.findOne({}, { sort: { startedAt: -1 } });
            // Determine scraper status:
            //   running — a run is in flight (we can't detect this from
            //             execution_logs because the recorder only inserts
            //             after the run completes, so treat as "idle" unless
            //             we have a strong signal otherwise)
            //   idle    — no recent run, OR outside the active window
            //   stopped — last run >3h ago, AND inside the active window
            //   error   — last run status was "error"
            let scraperStatus = 'idle';
            if (lastExecution) {
                const now = new Date();
                const lastRunMs = lastExecution.startedAt?.getTime();
                if (lastRunMs) {
                    const hoursSinceLastRun = (now.getTime() - lastRunMs) / (1000 * 60 * 60);
                    if (lastExecution.status === 'error') {
                        scraperStatus = 'error';
                    }
                    else if (hoursSinceLastRun > 3) {
                        // Active window: Argentina 07:00–24:00 (UTC hours 10–03 of next day).
                        // We mirror the health-checker's predicate: `argentinaHour >= 7`.
                        // Anything else (incl. 00:00–06:59 AR) is "idle", not "stopped".
                        const arHour = argentinaHourOf(now);
                        if (arHour >= 7) {
                            scraperStatus = 'stopped';
                        }
                        else {
                            scraperStatus = 'idle';
                        }
                    }
                }
            }
            // Last 7 days stats
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const last7Days = await execCollection.find({ startedAt: { $gte: sevenDaysAgo } }, {
                projection: {
                    status: 1, durationMs: 1, productsFound: 1, productsUpdated: 1, startedAt: 1,
                },
            }).toArray();
            const totalRuns = last7Days.length;
            const successRuns = last7Days.filter(e => e.status === 'success').length;
            const successRate = totalRuns > 0 ? Math.round((successRuns / totalRuns) * 100) : 0;
            const avgDurationMs = totalRuns > 0
                ? Math.round(last7Days.reduce((sum, e) => sum + (e.durationMs || 0), 0) / totalRuns)
                : 0;
            const totalProductsFound = last7Days.reduce((sum, e) => sum + (e.productsFound || 0), 0);
            const totalProductsUpdated = last7Days.reduce((sum, e) => sum + (e.productsUpdated || 0), 0);
            // Errors in last 24h
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const errors24h = await execCollection.countDocuments({
                startedAt: { $gte: oneDayAgo },
                status: 'error',
            });
            // Last execution time ago
            let lastExecutionTimeAgo = null;
            if (lastExecution?.startedAt) {
                const diffMs = Date.now() - lastExecution.startedAt.getTime();
                const diffMin = Math.floor(diffMs / 60000);
                if (diffMin < 1)
                    lastExecutionTimeAgo = 'Just now';
                else if (diffMin < 60)
                    lastExecutionTimeAgo = `${diffMin}m ago`;
                else
                    lastExecutionTimeAgo = `${Math.floor(diffMin / 60)}h ${diffMin % 60}m ago`;
            }
            const status = {
                scraperStatus,
                lastExecution,
                lastExecutionTimeAgo,
                avgDurationLast7Days: avgDurationMs,
                totalProductsFound,
                totalProductsUpdated,
                errorsLast24h: errors24h,
                successRateLast7Days: successRate,
            };
            res.json(status);
        }
        catch (error) {
            console.error('[API] Error getting status:', error);
            res.status(500).json({ error: 'Failed to get status' });
        }
    });
    /**
     * GET /history — paginated execution log.
     * Query params: page (default 1), limit (default 20, max 100),
     *               status (success|warning|error), from (ISO date), to (ISO date).
     */
    router.get('/history', async (req, res) => {
        try {
            const page = Math.max(1, parseInt(req.query.page) || 1);
            const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
            const status = req.query.status;
            const from = req.query.from;
            const to = req.query.to;
            const filter = {};
            if (status && ['success', 'warning', 'error'].includes(status)) {
                filter.status = status;
            }
            if (from || to) {
                filter.startedAt = {};
                if (from)
                    filter.startedAt.$gte = new Date(from);
                if (to)
                    filter.startedAt.$lte = new Date(to);
            }
            const [docs, total] = await Promise.all([
                execCollection.find(filter, {
                    sort: { startedAt: -1 },
                    skip: (page - 1) * limit,
                    limit,
                    projection: {
                        startedAt: 1, completedAt: 1, durationMs: 1, status: 1,
                        productsFound: 1, productsCreated: 1, productsUpdated: 1,
                        productsUnavailable: 1, errorCount: 1, triggerSource: 1,
                    },
                }).toArray(),
                execCollection.countDocuments(filter),
            ]);
            res.json({
                data: docs,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit),
                },
            });
        }
        catch (error) {
            console.error('[API] Error getting history:', error);
            res.status(500).json({ error: 'Failed to get history' });
        }
    });
    /**
     * GET /executions/:id — full execution detail incl. logs.
     * Returns 400 for invalid ObjectId, 404 if not found.
     */
    router.get('/executions/:id', async (req, res) => {
        try {
            let objectId;
            try {
                objectId = new mongodb_1.ObjectId(req.params.id);
            }
            catch {
                res.status(400).json({ error: 'Invalid execution ID' });
                return;
            }
            const doc = await execCollection.findOne({ _id: objectId });
            if (!doc) {
                res.status(404).json({ error: 'Execution not found' });
                return;
            }
            res.json(doc);
        }
        catch (error) {
            console.error('[API] Error getting execution:', error);
            res.status(500).json({ error: 'Failed to get execution' });
        }
    });
    /**
     * GET /metrics — pre-aggregated snapshots + computed summary.
     * Reads from metrics_snapshots ONLY (spec R5.5).
     * Query params: range (days, default 7, max 90).
     */
    router.get('/metrics', async (req, res) => {
        try {
            const range = parseInt(req.query.range) || 7;
            const days = Math.min(90, Math.max(1, range));
            let snapshots;
            if (metricsAggregator && typeof metricsAggregator.getMetrics === 'function') {
                snapshots = await metricsAggregator.getMetrics(days);
            }
            else {
                // Fallback: direct query if aggregator unavailable
                const since = new Date();
                since.setUTCDate(since.getUTCDate() - days);
                const sinceStr = since.toISOString().split('T')[0];
                snapshots = await metricsCollection.find({ date: { $gte: sinceStr } }, { sort: { date: -1 } }).toArray();
            }
            // Reverse to ascending (oldest → newest) for time-series charts
            const ascending = [...snapshots].reverse();
            // Compute summary across the window
            const totalRunsAcrossWindow = ascending.reduce((s, m) => s + (m.totalRuns || 0), 0);
            const daysWithRuns = ascending.filter(m => (m.totalRuns || 0) > 0).length;
            const avgDurationMs = daysWithRuns > 0
                ? Math.round(ascending.reduce((s, m) => s + (m.avgDurationMs || 0), 0) / ascending.length)
                : 0;
            const avgProductsFound = daysWithRuns > 0
                ? Math.round(ascending.reduce((s, m) => s + (m.avgProductsFound || 0), 0) / ascending.length)
                : 0;
            const avgSuccessRate = ascending.length > 0
                ? Math.round(ascending.reduce((s, m) => {
                    const rate = (m.totalRuns || 0) > 0
                        ? ((m.successCount || 0) / m.totalRuns) * 100
                        : 0;
                    return s + rate;
                }, 0) / ascending.length)
                : 0;
            const summary = {
                totalRuns: totalRunsAcrossWindow,
                avgDurationMs,
                avgProductsFound,
                avgSuccessRate,
                days: ascending.length,
            };
            res.json({ snapshots: ascending, summary });
        }
        catch (error) {
            console.error('[API] Error getting metrics:', error);
            res.status(500).json({ error: 'Failed to get metrics' });
        }
    });
    /**
     * GET /health — active (unresolved) health alerts.
     */
    router.get('/health', async (_req, res) => {
        try {
            let alerts;
            if (healthChecker && typeof healthChecker.getActiveAlerts === 'function') {
                alerts = await healthChecker.getActiveAlerts();
            }
            else {
                alerts = await healthCollection.find({ resolvedAt: { $exists: false } }, { sort: { detectedAt: -1 }, limit: 20 }).toArray();
            }
            // Count by severity for the badge in the dashboard
            const counts = {
                critical: alerts.filter((a) => a.severity === 'critical').length,
                warning: alerts.filter((a) => a.severity === 'warning').length,
                info: alerts.filter((a) => a.severity === 'info').length,
            };
            res.json({ alerts, activeCount: alerts.length, counts });
        }
        catch (error) {
            console.error('[API] Error getting health alerts:', error);
            res.status(500).json({ error: 'Failed to get health alerts' });
        }
    });
    /**
     * POST /health/check — manually trigger a scraper-stopped check.
     * Useful from the dashboard "Check now" button. Persists the alert if
     * one is detected.
     */
    router.post('/health/check', async (_req, res) => {
        try {
            const detected = [];
            if (healthChecker && typeof healthChecker.checkScraperStopped === 'function') {
                const alert = await healthChecker.checkScraperStopped();
                if (alert) {
                    // Persist the alert (mirrors checkAfterExecution behavior)
                    try {
                        await healthCollection.insertOne(alert);
                    }
                    catch (e) {
                        console.error('[API] Failed to persist manual health check:', e);
                    }
                    detected.push(alert);
                }
            }
            res.json({ checks: detected.length, detected });
        }
        catch (error) {
            console.error('[API] Error running health check:', error);
            res.status(500).json({ error: 'Failed to run health check' });
        }
    });
    return router;
}
