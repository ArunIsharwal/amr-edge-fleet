import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';

// FleetService ConnectRPC procedure paths
const STREAM_TELEMETRY_PATH = '/fleet.v1.FleetService/StreamFleetTelemetry';
const ASSIGN_TASK_PATH = '/fleet.v1.FleetService/AssignTask';
const TOGGLE_NODE_PATH = '/fleet.v1.FleetService/ToggleNode';

const GATEWAY_URL = (
  import.meta.env.VITE_GATEWAY_URL ||
  (typeof window !== 'undefined'
    ? (window.location.port === '5173' ? 'http://localhost:8080' : window.location.origin)
    : 'https://amr-edge-fleet.onrender.com')
).replace(/\/+$/, '');

/**
 * Creates a ConnectRPC streaming transport for connecting to an edge node
 */
export function createFleetClient(port) {
  const baseURL = `${GATEWAY_URL}/node/${port}`;

  return {
    // Continuous 10Hz Server-Sent / ReadableStream Telemetry Subscribing
    async *streamTelemetry(onCommandCallback) {
      try {
        const jsonStr = JSON.stringify({ clientId: 'dashboard' });
        const jsonBytes = new TextEncoder().encode(jsonStr);

        const reqBody = new Uint8Array(5 + jsonBytes.length);
        reqBody[0] = 0; // Data frame flag
        reqBody[1] = (jsonBytes.length >> 24) & 0xff;
        reqBody[2] = (jsonBytes.length >> 16) & 0xff;
        reqBody[3] = (jsonBytes.length >> 8) & 0xff;
        reqBody[4] = jsonBytes.length & 0xff;
        reqBody.set(jsonBytes, 5);

        const response = await fetch(`${baseURL}${STREAM_TELEMETRY_PATH}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/connect+json',
            'Connect-Protocol-Version': '1',
          },
          body: reqBody,
        });

        if (!response.ok || !response.body) {
          throw new Error(`Failed to stream telemetry from port ${port}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = new Uint8Array(0);

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          const newBuf = new Uint8Array(buffer.length + value.length);
          newBuf.set(buffer, 0);
          newBuf.set(value, buffer.length);
          buffer = newBuf;

          while (buffer.length >= 5) {
            const flags = buffer[0];
            const length = ((buffer[1] << 24) >>> 0) + (buffer[2] << 16) + (buffer[3] << 8) + buffer[4];

            if (buffer.length < 5 + length) {
              break; // Frame incomplete, wait for next chunk
            }

            const payloadBytes = buffer.slice(5, 5 + length);
            buffer = buffer.slice(5 + length);

            // Data frame (flags === 0)
            if ((flags & 0x02) === 0) {
              const jsonStr = decoder.decode(payloadBytes);
              try {
                const data = JSON.parse(jsonStr);
                yield data;
              } catch (e) {
                console.warn('[ConnectRPC] Failed to parse stream frame:', e);
              }
            }
          }
        }
      } catch (err) {
        console.warn(`[ConnectRPC] Stream disconnected on port ${port}:`, err);
      }
    },

    // Send Unary / Stream Commands to Edge Node
    async assignTask(task) {
      const res = await fetch(`${baseURL}${ASSIGN_TASK_PATH}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Connect-Protocol-Version': '1',
        },
        body: JSON.stringify({ task }),
      });
      return res.json();
    },

    async toggleNode(payload) {
      const res = await fetch(`${baseURL}${TOGGLE_NODE_PATH}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Connect-Protocol-Version': '1',
        },
        body: JSON.stringify(payload),
      });
      return res.json();
    },
  };
}
