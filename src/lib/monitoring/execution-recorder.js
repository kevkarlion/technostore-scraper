"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createExecutionRecorder = createExecutionRecorder;
/**
 * Create a recorder that wraps a scraper function with execution logging.
 *
 * Design contract:
 *   - A DB failure in the recorder MUST NEVER crash the scraper.
 *   - Every run produces exactly one execution_logs document
 *     (success / warning / error).
 *   - console.log / console.error output is captured to logEntries so
 *     the dashboard detail view can show what the scraper printed
 *     during the run, without depending on server.log.
 *   - The original scraper error is re-thrown to the caller after the
 *     error document is written, so the existing retry / fail-fast
 *     behavior in the HTTP route and cron is preserved.
 */
function createExecutionRecorder(config) {
    const db = config.db;
    const collection = db.collection(config.collectionNames?.executionLogs || 'execution_logs');
    async function recordExecution(triggerSource, scraperFn, options) {
        const startedAt = new Date();
        const logEntries = [];
        const originalLog = console.log;
        const originalError = console.error;
        // Capture console output for this execution.
        // We monkey-patch to capture logs in memory AND still output them.
        console.log = function (...args) {
            logEntries.push('[' + new Date().toISOString() + '] LOG: ' + args.join(' '));
            originalLog.apply(console, args);
        };
        console.error = function (...args) {
            logEntries.push('[' + new Date().toISOString() + '] ERROR: ' + args.join(' '));
            originalError.apply(console, args);
        };
        let result;
        let executionId = null;
        try {
            result = await scraperFn();
            const completedAt = new Date();
            const durationMs = completedAt.getTime() - startedAt.getTime();
            const stats = options?.extractStats?.(result) || {
                productsFound: 0,
                productsCreated: 0,
                productsUpdated: 0,
                productsUnavailable: 0,
                errors: [],
            };
            const status = stats.errors.length > 0 ? 'warning' : 'success';
            const doc = {
                startedAt,
                completedAt,
                durationMs,
                status,
                triggerSource,
                productsFound: stats.productsFound,
                productsCreated: stats.productsCreated,
                productsUpdated: stats.productsUpdated,
                productsUnavailable: stats.productsUnavailable,
                createdProductIds: stats.createdProductIds,
                updatedProductIds: stats.updatedProductIds,
                categoriesScraped: [],
                errorCount: stats.errors.length,
                errors: stats.errors.slice(0, 50), // cap at 50 errors
                logEntries: logEntries.slice(-200), // keep last 200 log lines
                metadata: {
                    durationCategory: durationMs < 60000 ? 'fast' : durationMs < 300000 ? 'normal' : 'slow',
                },
            };
            // Fire-and-forget insert — never block or crash the scraper.
            try {
                const insertResult = await collection.insertOne(doc);
                executionId = insertResult.insertedId.toString();
            }
            catch (insertError) {
                console.error('[Recorder] Failed to save execution log:', insertError);
            }
            return { result, executionId };
        }
        catch (scraperError) {
            const completedAt = new Date();
            const durationMs = completedAt.getTime() - startedAt.getTime();
            const errorMessage = scraperError instanceof Error ? scraperError.message : String(scraperError);
            const doc = {
                startedAt,
                completedAt,
                durationMs,
                status: 'error',
                triggerSource,
                productsFound: 0,
                productsCreated: 0,
                productsUpdated: 0,
                productsUnavailable: 0,
                categoriesScraped: [],
                errorCount: 1,
                errors: [errorMessage],
                logEntries: logEntries.slice(-200),
                metadata: { durationCategory: 'error' },
            };
            try {
                const insertResult = await collection.insertOne(doc);
                executionId = insertResult.insertedId.toString();
            }
            catch (insertError) {
                console.error('[Recorder] Failed to save error execution log:', insertError);
            }
            // Re-throw the original error so the caller still sees the failure.
            throw scraperError;
        }
        finally {
            // Restore original console functions.
            console.log = originalLog;
            console.error = originalError;
        }
    }
    return { recordExecution };
}
