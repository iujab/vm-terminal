/**
 * VNC WebSocket Proxy
 * Bridges noVNC client to the VNC server in the container
 */

import { createServer, IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { Socket, createConnection } from 'net';

const PROXY_PORT = 6081;
const VNC_HOST = 'localhost';
const VNC_PORT = 5900;

class VNCProxy {
    private wss: WebSocketServer;

    constructor(port: number) {
        const server = createServer();
        this.wss = new WebSocketServer({ server });

        this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
            console.log('noVNC client connected');
            this.handleConnection(ws);
        });

        server.listen(port, () => {
            console.log(`VNC WebSocket proxy running on ws://localhost:${port}`);
        });
    }

    private handleConnection(ws: WebSocket) {
        // Connect to VNC server
        const vnc = createConnection({ host: VNC_HOST, port: VNC_PORT }, () => {
            console.log('Connected to VNC server');
        });

        // Forward WebSocket data to VNC
        ws.on('message', (data: Buffer) => {
            if (vnc.writable) {
                vnc.write(data);
            }
        });

        // Forward VNC data to WebSocket
        vnc.on('data', (data: Buffer) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(data);
            }
        });

        // Handle WebSocket close
        ws.on('close', () => {
            console.log('noVNC client disconnected');
            vnc.end();
        });

        ws.on('error', (error) => {
            console.error('WebSocket error:', error);
            vnc.end();
        });

        // Handle VNC close
        vnc.on('close', () => {
            console.log('VNC connection closed');
            ws.close();
        });

        vnc.on('error', (error) => {
            console.error('VNC error:', error);
            ws.close();
        });
    }
}

// Start proxy if run directly
if (require.main === module) {
    new VNCProxy(PROXY_PORT);
}

export { VNCProxy };
