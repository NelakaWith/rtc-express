# 📨 rtc-express: WebRTC P2P AirDrop Portal

> **Note:** This is an experimental/self-learning codebase. It is not intended for production use. It serves as a playground to understand WebRTC Data Channels, SDP negotiation, and WebSocket-based signaling.

A serverless, browser-to-browser data channel application that allows direct peer-to-peer text chat and file transfers.

## Features

- **P2P Data Channel:** Direct browser-to-browser communication using WebRTC.
- **WebSocket Signaling Server:** A lightweight Node.js/`ws` server to relay SDP offers, answers, and ICE candidates.
- **Direct Messaging:** Send text messages directly across the open UDP-backed data channel.
- **File Transfer:** Binary chunking and reassembly for sending files over WebRTC (handles backpressure).
- **Vanilla JS & TailwindCSS:** Simple frontend without complex framework overhead.

## Architecture

1. **Signaling Server (`server.ts`):**
   - Listens on `ws://localhost:8080`.
   - Manages rooms and broadcasts messages (offers, answers, ICE candidates) to other connected peers.
2. **Client (`client/`):**
   - Establishes connection to the signaling server.
   - Caller creates a data channel and sends an SDP offer.
   - Callee receives the offer, creates an SDP answer, and waits for the data channel.
   - Both peers exchange ICE candidates (using Google's STUN server) to punch through NAT and establish a direct connection.

## How to Run

### 1. Start the Signaling Server

Ensure you have Node.js installed, then install the dependencies and run the server using `tsx`:

```bash
npm install
npx tsx server.ts
```

_(The server will start on port 8080)._

### 2. Open the Client

Since there is no frontend bundler, you can simply open the `client/index.html` file in your browser.

For the best experience, use a simple static server:

```bash
npx serve client
```

Or just double-click `client/index.html`.

### 3. Connect Peers

1. Open the client in **two separate browser windows** (or tabs).
2. Enter the same **Room Name** in both windows.
3. In Window A, click **"📞 Start as Caller"**.
4. In Window B, click **"📱 Join as Callee"**.
5. Once the status shows **"P2P Connected"**, you can chat and send files directly between the windows!

## Technologies Used

- [WebRTC API](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
- [ws](https://github.com/websockets/ws) (Node.js WebSockets)
- [TailwindCSS](https://tailwindcss.com/) (via CDN for rapid prototyping)
- TypeScript & `tsx`

## License
MIT
