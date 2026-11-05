// WebRTC camera module: peer-to-peer video from phone to VR headset.
// Sender adds a camera MediaStream track; receiver gets it with <100 ms
// latency at full frame rate — no JPEG round-trip through the server.

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

function signalingUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/rtc`;
}

function connectSignaling(role, onMessage, onOpen, onClose) {
  const ws = new WebSocket(signalingUrl());
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "join", role }));
    onOpen?.();
  };
  ws.onmessage = (event) => {
    try { onMessage(JSON.parse(event.data)); } catch { /* ignore malformed */ }
  };
  ws.onclose = () => onClose?.();
  ws.onerror = () => {};
  return ws;
}

// ── Sender (phone) ─────────────────────────────────────────────────────
export function createWebRtcSender(mediaStream) {
  let ws = null;
  let pc = null;
  let generation = 0;
  const peers = new Map();
  let onStatus = () => {};

  function createPeerForReceiver(receiverId) {
    const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    for (const track of mediaStream.getTracks()) {
      peer.addTrack(track, mediaStream);
    }
    peer.onicecandidate = (event) => {
      if (event.candidate && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "candidate", candidate: event.candidate }));
      }
    };
    peer.onconnectionstatechange = () => {
      onStatus(peer.connectionState);
    };
    return peer;
  }

  async function handleMessage(msg) {
    if (msg.type === "answer") {
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(msg));
    } else if (msg.type === "candidate") {
      if (!pc) return;
      await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
    } else if (msg.type === "request-offer") {
      pc?.close();
      pc = createPeerForReceiver();
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      ws?.send(JSON.stringify({ type: "offer", sdp: offer.sdp }));
    }
  }

  function start(statusCallback) {
    const gen = ++generation;
    if (statusCallback) onStatus = statusCallback;

    ws = connectSignaling("sender", handleMessage, () => {
      onStatus("connected-to-signal");
    }, () => {
      if (gen !== generation) return;
      onStatus("signal-disconnected");
      setTimeout(() => { if (gen === generation) start(statusCallback); }, 2000);
    });
  }

  function stop() {
    generation++;
    pc?.close(); pc = null;
    ws?.close(); ws = null;
    peers.clear();
  }

  return { start, stop };
}

// ── Receiver (VR headset / HUD) ────────────────────────────────────────
export function createWebRtcReceiver() {
  let ws = null;
  let pc = null;
  let generation = 0;
  let onTrack = () => {};
  let onStatus = () => {};

  async function handleMessage(msg) {
    if (msg.type === "sender-ready") {
      ws?.send(JSON.stringify({ type: "request-offer" }));
      onStatus("requesting-offer");
    } else if (msg.type === "sender-left") {
      pc?.close(); pc = null;
      onStatus("sender-left");
    } else if (msg.type === "offer") {
      pc?.close();
      pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pc.ontrack = (event) => {
        onTrack(event.streams[0] ?? new MediaStream([event.track]));
        onStatus("streaming");
      };
      pc.onicecandidate = (event) => {
        if (event.candidate && ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "candidate", candidate: event.candidate }));
        }
      };
      pc.onconnectionstatechange = () => {
        const state = pc?.connectionState;
        if (state === "failed" || state === "disconnected") onStatus(state);
      };
      await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: msg.sdp }));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      ws?.send(JSON.stringify({ type: "answer", sdp: answer.sdp }));
    } else if (msg.type === "candidate") {
      if (!pc) return;
      await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
    }
  }

  function start(trackCallback, statusCallback) {
    const gen = ++generation;
    if (trackCallback) onTrack = trackCallback;
    if (statusCallback) onStatus = statusCallback;

    ws = connectSignaling("receiver", handleMessage, () => {
      onStatus("waiting-for-sender");
    }, () => {
      if (gen !== generation) return;
      onStatus("signal-disconnected");
      setTimeout(() => { if (gen === generation) start(trackCallback, statusCallback); }, 2000);
    });
  }

  function stop() {
    generation++;
    pc?.close(); pc = null;
    ws?.close(); ws = null;
  }

  return { start, stop };
}
