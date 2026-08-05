import { WebSocketServer, WebSocket } from "ws";

// The types of messages browsers will send each other
type MessageType = "offer" | "answer" | "ice-candidate" | "join-room";

// The generic shape of every incoming JSON message
interface SignalingMessage {
  type: MessageType;
  payload: any; // We keep this generic for the relay, as the server doesn't care what's inside
}

const wss = new WebSocketServer({ port: 8080 });
const clients = new Set<WebSocket>();

wss.on("connection", function connection(ws: WebSocket) {
  // 1. Manage the Client Set: Add new connection
  clients.add(ws);
  console.log(`[Server] Client connected. Active connections: ${clients.size}`);

  ws.on("error", console.error);

  // 2. The Broadcast Loop & Buffer Handling
  ws.on("message", (data: Buffer) => {
    try {
      // 3. Convert raw binary Buffer to string, then parse and cast
      const rawString = data.toString();
      const message = JSON.parse(rawString) as SignalingMessage;

      console.log(`[Server] Relaying message of type: "${message.type}"`);

      // Broadcast to all peers except the sender, ensuring connection is open
      for (const client of clients) {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(rawString);
        }
      }
    } catch (error) {
      console.error(
        "[Server] Failed to parse incoming message as JSON:",
        error,
      );
    }
  });
  // 5. Cleanup: Remove client from Set on close to prevent memory leaks
  ws.on("close", () => {
    clients.delete(ws);
    console.log(
      `[Server] Client disconnected. Active connections: ${clients.size}`,
    );
  });
});
console.log("🚀 Signaling Server running successfully on ws://localhost:8080");
