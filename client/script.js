const logBox = document.getElementById("log-box");
const statusBadge = document.getElementById("connection-status");
const roomInput = document.getElementById("room-input");
const msgInput = document.getElementById("msg-input");
const sendBtn = document.getElementById("btn-send");
const callerBtn = document.getElementById("btn-caller");
const calleeBtn = document.getElementById("btn-callee");

let ws = null;
let pc = null;
let dataChannel = null;
let currentRoom = "";

// Helper logging utility to track state transitions in the UI log box
function log(msg, type = "sys") {
  const entry = document.createElement("div");
  let color = "text-slate-400";
  if (type === "peer") color = "text-emerald-400 font-semibold";
  if (type === "err") color = "text-rose-400";
  if (type === "action") color = "text-indigo-400";

  entry.className = `${color} leading-relaxed`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logBox.appendChild(entry);
  logBox.scrollTop = logBox.scrollHeight;
}

// 1. Establish WebSocket Connection to the Signaling Server
function connectSignaling() {
  // Connect to our running Node.js WebSocket matchmaker server
  ws = new WebSocket("ws://localhost:8080");

  ws.onopen = () => {
    log("Connected to signaling server", "action");
    statusBadge.textContent = "● Signaling Connected";
    statusBadge.className =
      "bg-amber-950/60 border border-amber-500/30 text-amber-400 text-xs font-mono px-3 py-1.5 rounded-full";
  };

  // Handle incoming signaling messages relayed from the remote peer
  ws.onmessage = async (event) => {
    const message = JSON.parse(event.data);
    log(`Received signaling message: ${message.type}`, "action");

    if (!pc) return;

    if (message.type === "offer") {
      // Callee receives SDP offer, sets it as remote description, creates and sends answer
      await pc.setRemoteDescription(new RTCSessionDescription(message.payload));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      ws.send(
        JSON.stringify({
          type: "answer",
          room: currentRoom,
          payload: answer,
        }),
      );
      log("Created and sent SDP Answer", "action");
    } else if (message.type === "answer") {
      // Caller receives SDP answer and sets it as remote description
      await pc.setRemoteDescription(new RTCSessionDescription(message.payload));
      log("Remote description set from answer", "action");
    } else if (message.type === "ice-candidate") {
      // Add discovered network routing candidate from peer
      try {
        await pc.addIceCandidate(new RTCIceCandidate(message.payload));
        log("Added remote ICE candidate", "action");
      } catch (e) {
        log(`Error adding received ICE candidate: ${e.message}`, "err");
      }
    }
  };

  ws.onerror = (err) => log(`WebSocket error: ${err.message}`, "err");
  ws.onclose = () => {
    log("Disconnected from signaling server", "err");
    statusBadge.textContent = "● Disconnected";
    statusBadge.className =
      "bg-rose-950/60 border border-rose-500/30 text-rose-400 text-xs font-mono px-3 py-1.5 rounded-full";
  };
}

// 2. Initialize the RTCPeerConnection Engine
function createPeerConnection(isCaller) {
  // Instantiate WebRTC peer engine using Google's public STUN server for NAT hole-punching
  pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  // Whenever local network paths are discovered, broadcast them to the remote peer via signaling
  pc.onicecandidate = (event) => {
    if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "ice-candidate",
          room: currentRoom,
          payload: event.candidate,
        }),
      );
    }
  };

  if (isCaller) {
    // The Caller explicitly creates the direct RTCDataChannel before negotiation
    dataChannel = pc.createDataChannel("p2p-chat");
    setupDataChannelHandlers();
  } else {
    // The Callee waits for the remote peer's incoming data channel event
    pc.ondatachannel = (event) => {
      dataChannel = event.channel;
      setupDataChannelHandlers();
      log("Received DataChannel from Caller", "peer");
    };
  }
}

// 3. Configure Event Listeners for the Direct Data Channel Pipeline
function setupDataChannelHandlers() {
  dataChannel.onopen = () => {
    log("🎉 P2P Data Channel OPEN and ready!", "peer");
    statusBadge.textContent = "● P2P Connected";
    statusBadge.className =
      "bg-emerald-950/60 border border-emerald-500/30 text-emerald-400 text-xs font-mono px-3 py-1.5 rounded-full";
    msgInput.disabled = false;
    sendBtn.disabled = false;
    sendBtn.classList.remove("cursor-not-allowed");
  };

  dataChannel.onclose = () => {
    log("Data Channel closed", "err");
    msgInput.disabled = true;
    sendBtn.disabled = true;
  };

  // Handle incoming chat payloads sent directly over the UDP-backed data channel
  dataChannel.onmessage = (e) => {
    log(`Peer Message: "${e.data}"`, "peer");
  };
}

// 4. Bind UI Actions and Handshake Triggers
callerBtn.addEventListener("click", async () => {
  currentRoom = roomInput.value.trim() || "default-room";
  connectSignaling();
  createPeerConnection(true);

  // Join signaling room and create SDP Offer
  setTimeout(async () => {
    ws.send(JSON.stringify({ type: "join-room", room: currentRoom }));
    log(`Joined room "${currentRoom}" as Caller`, "action");

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send(
      JSON.stringify({
        type: "offer",
        room: currentRoom,
        payload: offer,
      }),
    );
    log("Created and sent SDP Offer", "action");
  }, 500);

  callerBtn.disabled = true;
  calleeBtn.disabled = true;
});

calleeBtn.addEventListener("click", async () => {
  currentRoom = roomInput.value.trim() || "default-room";
  connectSignaling();
  createPeerConnection(false);

  // Join signaling room and wait for incoming SDP offer
  setTimeout(() => {
    ws.send(JSON.stringify({ type: "join-room", room: currentRoom }));
    log(
      `Joined room "${currentRoom}" as Callee. Waiting for offer...`,
      "action",
    );
  }, 500);

  callerBtn.disabled = true;
  calleeBtn.disabled = true;
});

// Transmit text messages directly across the open P2P data channel
sendBtn.addEventListener("click", () => {
  const val = msgInput.value.trim();
  if (val && dataChannel && dataChannel.readyState === "open") {
    dataChannel.send(val);
    log(`You: "${val}"`, "sys");
    msgInput.value = "";
  }
});

msgInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendBtn.click();
});

document.getElementById("btn-clear").addEventListener("click", () => {
  logBox.innerHTML = '<div class="text-slate-500">// Log cleared.</div>';
});
