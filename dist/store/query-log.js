import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Get the magnify root directory (parent of dist folder)
const MAGNIFY_ROOT = path.resolve(__dirname, '../..');
/**
 * File-based persistence for query logs
 */
export class QueryLogPersistence {
    logsDir;
    constructor(logsDir) {
        // Default to 'logs/queries' directory in magnify folder
        this.logsDir = logsDir || path.join(MAGNIFY_ROOT, 'logs', 'queries');
        this.ensureLogsDirectory();
    }
    /**
     * Ensure the logs directory exists
     */
    ensureLogsDirectory() {
        if (!fs.existsSync(this.logsDir)) {
            fs.mkdirSync(this.logsDir, { recursive: true });
            console.log(`Created query logs directory: ${this.logsDir}`);
        }
    }
    /**
     * Get the file path for a query log
     * Note: queryId now includes query slug, so filename is descriptive
     */
    getLogPath(queryId) {
        return path.join(this.logsDir, `${queryId}.json`);
    }
    /**
     * Save a query log to disk
     */
    async saveLog(log) {
        const filePath = this.getLogPath(log.queryId);
        const data = JSON.stringify(log, null, 2);
        await fs.promises.writeFile(filePath, data, 'utf-8');
        console.log(`Saved query log: ${log.queryId}`);
    }
    /**
     * Load a query log from disk
     */
    async loadLog(queryId) {
        const filePath = this.getLogPath(queryId);
        if (!fs.existsSync(filePath)) {
            return null;
        }
        try {
            const data = await fs.promises.readFile(filePath, 'utf-8');
            const log = JSON.parse(data);
            // Restore Date object
            log.timestamp = new Date(log.timestamp);
            return log;
        }
        catch (error) {
            console.error(`Error loading query log ${queryId}:`, error);
            return null;
        }
    }
    /**
     * List all query log IDs
     */
    async listLogIds() {
        try {
            const files = await fs.promises.readdir(this.logsDir);
            return files
                .filter(file => file.endsWith('.json'))
                .map(file => path.basename(file, '.json'))
                .sort((a, b) => b.localeCompare(a)); // Most recent first (assuming UUIDs are time-sortable)
        }
        catch (error) {
            console.error('Error listing query logs:', error);
            return [];
        }
    }
    /**
     * Load all query logs
     */
    async loadAllLogs() {
        const ids = await this.listLogIds();
        const logs = [];
        for (const id of ids) {
            const log = await this.loadLog(id);
            if (log) {
                logs.push(log);
            }
        }
        return logs;
    }
    /**
     * Load recent logs (limited count)
     */
    async loadRecentLogs(limit = 50) {
        const ids = await this.listLogIds();
        const limitedIds = ids.slice(0, limit);
        const logs = [];
        for (const id of limitedIds) {
            const log = await this.loadLog(id);
            if (log) {
                logs.push(log);
            }
        }
        return logs;
    }
    /**
     * Load logs for a specific document
     */
    async loadLogsForDocument(documentId) {
        const allLogs = await this.loadAllLogs();
        return allLogs.filter(log => log.documentId === documentId);
    }
    /**
     * Delete a query log
     */
    async deleteLog(queryId) {
        const filePath = this.getLogPath(queryId);
        if (!fs.existsSync(filePath)) {
            return false;
        }
        try {
            await fs.promises.unlink(filePath);
            console.log(`Deleted query log: ${queryId}`);
            return true;
        }
        catch (error) {
            console.error(`Error deleting query log ${queryId}:`, error);
            return false;
        }
    }
    /**
     * Delete all logs for a document
     */
    async deleteLogsForDocument(documentId) {
        const logs = await this.loadLogsForDocument(documentId);
        let deleted = 0;
        for (const log of logs) {
            if (await this.deleteLog(log.queryId)) {
                deleted++;
            }
        }
        return deleted;
    }
    /**
     * Get logs directory stats
     */
    async getStats() {
        const ids = await this.listLogIds();
        let totalSize = 0;
        for (const id of ids) {
            const filePath = this.getLogPath(id);
            try {
                const stats = await fs.promises.stat(filePath);
                totalSize += stats.size;
            }
            catch {
                // Ignore errors for individual files
            }
        }
        return {
            totalLogs: ids.length,
            totalSizeBytes: totalSize,
            logsDirectory: this.logsDir,
        };
    }
}
/**
 * Create a query log persistence instance
 */
export function createQueryLogPersistence(logsDir) {
    return new QueryLogPersistence(logsDir);
}
//# sourceMappingURL=query-log.js.map