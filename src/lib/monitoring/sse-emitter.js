"use strict";
// Client manager for Server-Sent Events (SSE).
//
// Usage (server.ts):
//   const sseEmitter = createSSEEmitter();
//   // Pass to monitoring router for GET /events endpoint
//   // Call sseEmitter.broadcast('health-alert', alert) when health check detects an anomaly
//
// SSE clients auto-reconnect by design (EventSource spec).
// We avoid client-side event IDs because the health-alert stream is ephemeral
// — the dashboard re-fetches full state from GET /health on reconnect.
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSSEEmitter = createSSEEmitter;
function createSSEEmitter() {
    const clients = new Set();
    function addClient(res) {
        clients.add(res);
        res.on('close', () => {
            clients.delete(res);
        });
    }
    function removeClient(res) {
        clients.delete(res);
    }
    function broadcast(event, data) {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        for (const client of clients) {
            try {
                client.write(payload);
            }
            catch {
                clients.delete(client);
            }
        }
    }
    function getClientCount() {
        return clients.size;
    }
    return { addClient, removeClient, broadcast, getClientCount };
}
