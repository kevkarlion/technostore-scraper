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

export interface SSEEmitter {
  addClient(res: any): void;
  removeClient(res: any): void;
  broadcast(event: string, data: unknown): void;
  getClientCount(): number;
}

export function createSSEEmitter(): SSEEmitter {
  const clients = new Set<any>();

  function addClient(res: any): void {
    clients.add(res);
    res.on('close', () => {
      clients.delete(res);
    });
  }

  function removeClient(res: any): void {
    clients.delete(res);
  }

  function broadcast(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) {
      try {
        client.write(payload);
      } catch {
        clients.delete(client);
      }
    }
  }

  function getClientCount(): number {
    return clients.size;
  }

  return { addClient, removeClient, broadcast, getClientCount };
}
