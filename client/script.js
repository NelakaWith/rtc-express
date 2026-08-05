const logBox = document.getElementById("log-box");
const statusBadge = document.getElementById("connection-status");
const statusDot = document.getElementById("status-dot");
const roomInput = document.getElementById("room-input");
const msgInput = document.getElementById("msg-input");
const sendBtn = document.getElementById("btn-send");
const sendFileBtn = document.getElementById("btn-file-send");
const callerBtn = document.getElementById("btn-caller");
const calleeBtn = document.getElementById("btn-callee");
const fileInput = document.getElementById("file-input");

let ws = null;
let pc = null;
let dataChannel = null;
let currentRoom = "";

// Helper logging utility to track state transitions in the UI log box
function log(msg, type = "sys") {
  const entry = document.createElement("div");
  let color = "text-zinc-400";
  if (type === "peer") color = "text-emerald-400 font-medium";
  if (type === "err") color = "text-rose-400";
  if (type === "action") color = "text-indigo-400";

  entry.className = `${color} leading-relaxed`;
  entry.innerHTML = `<span class="text-zinc-600 mr-2">[${new Date().toLocaleTimeString()}]</span> ${msg}`;
  logBox.appendChild(entry);
  logBox.scrollTop = logBox.scrollHeight;
}

// 1. Establish WebSocket Connection to the Signaling Server
function connectSignaling() {
  // Connect to our running Node.js WebSocket matchmaker server
  ws = new WebSocket("ws://localhost:8080");

  ws.onopen = () => {
    log("Connected to signaling server", "action");
    statusBadge.textContent = "Signaling Connected";
    statusDot.className = "w-2 h-2 rounded-full bg-amber-500";
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

  ws.onerror = (err) => log(`WebSocket error`, "err");
  ws.onclose = () => {
    log("Disconnected from signaling server", "err");
    statusBadge.textContent = "Disconnected";
    statusDot.className = "w-2 h-2 rounded-full bg-rose-500";
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
    log("P2P Data Channel open and ready", "peer");
    statusBadge.textContent = "P2P Connected";
    statusDot.className = "w-2 h-2 rounded-full bg-emerald-500";
    
    msgInput.disabled = false;
    sendBtn.disabled = false;
    fileInput.disabled = false;
    sendFileBtn.disabled = false;
  };

  dataChannel.onclose = () => {
    log("Data Channel closed", "err");
    msgInput.disabled = true;
    sendBtn.disabled = true;
    fileInput.disabled = true;
    sendFileBtn.disabled = true;
  };

  // Handle incoming chat payloads sent directly over the UDP-backed data channel
  dataChannel.onmessage = (event) => {
    // 1. Check if the incoming packet is a text message (JSON metadata)
    if (typeof event.data === "string") {
      try {
        const message = JSON.parse(event.data);

        if (message.signal === "file-meta") {
          incomingFileMeta = message;
          receivedBuffers = [];
          receivedSize = 0;
          log(
            `Incoming file: ${incomingFileMeta.name} (${incomingFileMeta.size} bytes)`,
            "peer",
          );
          return; // Stop here so it doesn't log as a generic chat message
        }
      } catch (e) {
        // Not JSON, treat as a normal chat message
      }

      // Regular text chat message
      log(`Peer Message: "${event.data}"`, "peer");
    } else {
      handleIncomingData(event);
    }
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
  logBox.innerHTML = '<div class="text-zinc-600">// Log cleared.</div>';
});

// -------------------------------------------
// File handling through binary streaming
// -------------------------------------------

// ==========================================
// 1. SENDER SIDE: Binary Chunker & Backpressure
// ==========================================
let selectedFile = null;
const CHUNK_SIZE = 64 * 1024; // 64KB per chunk
let offset = 0;
let fileToSend = null;
const reader = new FileReader();

function sendFile(file) {
  fileToSend = file;
  offset = 0;

  // Step A: Send metadata packet first so the receiver knows what to expect
  dataChannel.send(
    JSON.stringify({
      signal: "file-meta", // <-- Explicit signal tag
      name: file.name,
      size: file.size,
      fileType: file.type,
    }),
  );

  log(`Starting file transfer: ${file.name} (${file.size} bytes)`, "action");
  readNextChunk();
}

sendFileBtn.addEventListener("click", () => {
  if (fileInput.files && fileInput.files[0]) {
    selectedFile = fileInput.files[0];
    sendFile(selectedFile);
  }
});

function readNextChunk() {
  if (!fileToSend) return;

  // Backpressure Control: Check if browser's internal network buffer is too full
  const MAX_BUFFERED_AMOUNT = 64 * 1024 * 1024; // 1MB safety threshold
  if (dataChannel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
    // Pause and wait for buffer to drain via low-water mark event
    dataChannel.onbufferedamountlow = () => {
      dataChannel.onbufferedamountlow = null; // Reset handler
      readNextChunk();
    };
    return;
  }

  const slice = fileToSend.slice(offset, offset + CHUNK_SIZE);
  reader.readAsArrayBuffer(slice);
}

reader.onload = (e) => {
  const buffer = e.target.result;

  // Send raw binary ArrayBuffer directly through the P2P data channel
  dataChannel.send(buffer);

  offset += buffer.byteLength;

  // Update progress percentage
  const progress = Math.round((offset / fileToSend.size) * 100);
  if (progress % 20 === 0) {
    log(`File transfer progress: ${progress}%`, "sys");
  }

  if (offset < fileToSend.size) {
    readNextChunk();
  } else {
    log("File transmission complete.", "peer");
    fileToSend = null;
  }
};

// ==========================================
// 2. RECEIVER SIDE: Reassembly & Download
// ==========================================
let incomingFileMeta = null;
let receivedBuffers = [];
let receivedSize = 0;

function handleIncomingData(event) {
  // Check if the incoming packet is a text control message (Metadata) or raw binary chunk
  if (typeof event.data === "string") {
    const message = JSON.parse(event.data);

    if (message.type === "file-meta") {
      incomingFileMeta = message;
      receivedBuffers = [];
      receivedSize = 0;
      log(
        `Incoming file detected: ${incomingFileMeta.name} (${incomingFileMeta.size} bytes)`,
        "peer",
      );
    }
  } else {
    // It's a raw binary ArrayBuffer chunk! Push it into our staging array
    receivedBuffers.push(event.data);
    receivedSize += event.data.byteLength;

    // Check if we have received all bytes
    if (incomingFileMeta && receivedSize >= incomingFileMeta.size) {
      log(`File received. Reassembling...`, "peer");

      // Combine all ArrayBuffers into a single massive Blob
      const completeBlob = new Blob(receivedBuffers);
      const downloadUrl = URL.createObjectURL(completeBlob);

      // Create a clickable download link in your log box or UI
      log(
        `Ready: <a href="${downloadUrl}" download="${incomingFileMeta.name}" class="text-zinc-200 underline font-medium hover:text-white transition-colors">${incomingFileMeta.name}</a>`,
        "peer",
      );

      // Reset state
      incomingFileMeta = null;
      receivedBuffers = [];
      receivedSize = 0;
    }
  }
}
