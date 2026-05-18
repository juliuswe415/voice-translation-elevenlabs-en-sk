let ws = null;
let conversation = null;

let micStream = null;
let recorder = null;
let recordedChunks = [];

let audioCtx = null;
let workletNode = null;

let outputCtx = null;
let nextPlayTime = 0;

let isRunning = false;
let isStarting = false;
let isAgentSpeaking = false;
let agentSpeakingTimeout = null;

const SAMPLE_RATE_OUT = 16000;
const CHUNK_SAMPLES = 1600;

const THRESHOLD_IDLE = 0.001;
const THRESHOLD_AGENT_SPEAKING = 0.04;

const PRE_ROLL_MS = 300;
const SEND_WINDOW_IDLE_MS = 1500;
const SEND_WINDOW_AGENT_SPEAKING_MS = 700;
const PRE_ROLL_CHUNKS = Math.ceil(PRE_ROLL_MS / 100);

let sendUntilTime = 0;
let preRollChunks = [];
let isSendingWindowActive = false;
let pcmBuffer = [];

const startBtn = document.getElementById("startBtn");
const statusEl = document.getElementById("status");
const debugLogEl = document.getElementById("debugLog");
const debugEnabledEl = document.getElementById("debugEnabled");

let debugCounter = 0;

function debugLog(message) {
  if (!debugEnabledEl?.checked) return;
  if (!debugLogEl) return;

  debugCounter++;

  debugLogEl.textContent =
    `[${debugCounter}] ${message}\n` + debugLogEl.textContent;

  const lines = debugLogEl.textContent.split("\n").slice(0, 35);
  debugLogEl.textContent = lines.join("\n");
}

function updateStatus(message, type = "default") {
  statusEl.textContent = `Status: ${message}`;
  statusEl.className = type;
}

function getEchoMode() {
  return document.querySelector('input[name="echoMode"]:checked')?.value || "mute";
}

function calculateRMS(floatSamples) {
  let sum = 0;

  for (let i = 0; i < floatSamples.length; i++) {
    sum += floatSamples[i] * floatSamples[i];
  }

  return Math.sqrt(sum / floatSamples.length);
}

function floatTo16BitPCM(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < float32Array.length; i++) {
    const sample = Math.max(-1, Math.min(1, float32Array[i]));

    view.setInt16(
      i * 2,
      sample < 0 ? sample * 0x8000 : sample * 0x7fff,
      true
    );
  }

  return new Uint8Array(buffer);
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}

function downsampleTo16k(input, inputSampleRate) {
  if (inputSampleRate === SAMPLE_RATE_OUT) return input;

  const ratio = inputSampleRate / SAMPLE_RATE_OUT;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const sourceIndex = Math.floor(i * ratio);
    output[i] = input[sourceIndex];
  }

  return output;
}

function reallySendPcmChunk(floatSamples) {
  const pcm16 = floatTo16BitPCM(floatSamples);
  const base64Audio = arrayBufferToBase64(pcm16.buffer);

  ws.send(JSON.stringify({
    user_audio_chunk: base64Audio
  }));
}

function sendPcmChunk(floatSamples) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const echoMode = getEchoMode();

  if (isAgentSpeaking && echoMode === "mute") {
    return;
  }

  if (echoMode !== "threshold") {
    reallySendPcmChunk(floatSamples);
    return;
  }

  const rms = calculateRMS(floatSamples);

  const threshold = isAgentSpeaking
    ? THRESHOLD_AGENT_SPEAKING
    : THRESHOLD_IDLE;

  const windowMs = isAgentSpeaking
    ? SEND_WINDOW_AGENT_SPEAKING_MS
    : SEND_WINDOW_IDLE_MS;

  const now = performance.now();

  preRollChunks.push(floatSamples);

  if (preRollChunks.length > PRE_ROLL_CHUNKS) {
    preRollChunks.shift();
  }

  const triggered = rms >= threshold;

  if (triggered) {
    sendUntilTime = now + windowMs;

    if (!isSendingWindowActive) {
      isSendingWindowActive = true;

      for (const chunk of preRollChunks) {
        reallySendPcmChunk(chunk);
      }

      debugLog(`TRIGGER rms=${rms.toFixed(5)} speaking=${isAgentSpeaking}`);
      return;
    }
  }

  const shouldSend = now <= sendUntilTime;

  if (shouldSend) {
    reallySendPcmChunk(floatSamples);
  } else {
    isSendingWindowActive = false;
  }
}

function handleInputSamples(samples, inputSampleRate) {
  const downsampled = downsampleTo16k(samples, inputSampleRate);

  for (const sample of downsampled) {
    pcmBuffer.push(sample);

    if (pcmBuffer.length >= CHUNK_SAMPLES) {
      const chunk = new Float32Array(pcmBuffer.slice(0, CHUNK_SAMPLES));
      pcmBuffer = pcmBuffer.slice(CHUNK_SAMPLES);

      sendPcmChunk(chunk);
    }
  }
}

function playPcm16Base64(base64Audio) {
  isAgentSpeaking = true;

  const binary = atob(base64Audio);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const sampleCount = bytes.length / 2;
  const floatSamples = new Float32Array(sampleCount);
  const view = new DataView(bytes.buffer);

  for (let i = 0; i < sampleCount; i++) {
    floatSamples[i] = view.getInt16(i * 2, true) / 32768;
  }

  if (!outputCtx) {
    outputCtx = new AudioContext();
    nextPlayTime = outputCtx.currentTime;
  }

  const audioBuffer = outputCtx.createBuffer(1, sampleCount, SAMPLE_RATE_OUT);
  audioBuffer.copyToChannel(floatSamples, 0);

  const source = outputCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(outputCtx.destination);

  const startTime = Math.max(outputCtx.currentTime, nextPlayTime);
  source.start(startTime);

  nextPlayTime = startTime + audioBuffer.duration;

  clearTimeout(agentSpeakingTimeout);

  const remainingMs = Math.max(
    300,
    (nextPlayTime - outputCtx.currentTime) * 1000 + 250
  );

  agentSpeakingTimeout = setTimeout(() => {
    isAgentSpeaking = false;
  }, remainingMs);
}

function startLocalRecording(stream) {
  recordedChunks = [];

  recorder = new MediaRecorder(stream);

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };

  recorder.onstop = () => {
    if (!recordedChunks.length) return;

    const blob = new Blob(recordedChunks, { type: "audio/webm" });
    const url = URL.createObjectURL(blob);

    const oldLink = document.getElementById("recordingDownloadLink");
    if (oldLink) oldLink.remove();

    const a = document.createElement("a");
    a.id = "recordingDownloadLink";
    a.href = url;
    a.download = `mic-test-${Date.now()}.webm`;
    a.textContent = "Download recorded mic audio";
    a.style.display = "block";
    a.style.marginTop = "15px";
    a.style.textAlign = "center";

    document.querySelector(".container").appendChild(a);
  };

  recorder.start();
}

async function createAudioWorklet() {
  const workletCode = `
    class MicProcessor extends AudioWorkletProcessor {
      process(inputs) {
        const input = inputs[0];

        if (input && input[0]) {
          this.port.postMessage(input[0]);
        }

        return true;
      }
    }

    registerProcessor("mic-processor", MicProcessor);
  `;

  const blob = new Blob([workletCode], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);

  await audioCtx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
}

async function getSignedUrl() {
  updateStatus("Getting authentication...", "default");

  const authResponse = await fetch("/api/get-signed-url");

  if (!authResponse.ok) {
    const errorData = await authResponse.json().catch(() => ({}));
    throw new Error(
      errorData.error || `Failed to get signed URL (${authResponse.status})`
    );
  }

  const { signedUrl } = await authResponse.json();

  if (!signedUrl) {
    throw new Error("No signed URL received");
  }

  return signedUrl;
}

async function startSdkSession(signedUrl) {
  updateStatus("Loading SDK...", "default");

  const { Conversation } = await import(
    "https://cdn.jsdelivr.net/npm/@elevenlabs/client/+esm"
  );

  updateStatus("Requesting microphone access...", "default");

  const permissionStream =
    await navigator.mediaDevices.getUserMedia({ audio: true });

  permissionStream.getTracks().forEach(track => track.stop());

  updateStatus("Connecting via Conversation.startSession()...", "default");

  conversation = await Conversation.startSession({
    signedUrl,

    onConnect: () => {
      isStarting = false;
      updateStatus("Ready - SDK mode", "active");
      startBtn.textContent = "Stop Translation";
      startBtn.disabled = false;
    },

    onMessage: (message) => {
      updateStatus(`AI: ${message.message}`, "active");
      debugLog(`SDK=${JSON.stringify(message)}`);
    },

    onError: (error) => {
      isStarting = false;
      updateStatus(`Error: ${error.message || "Connection error"}`, "error");
      conversation = null;
      startBtn.textContent = "Start Translation";
      startBtn.disabled = false;
    },

    onDisconnect: () => {
      isStarting = false;
      conversation = null;
      updateStatus("Disconnected", "default");
      startBtn.textContent = "Start Translation";
      startBtn.disabled = false;
    }
  });
}

async function startWebSocketSession(signedUrl) {
  updateStatus("Requesting microphone...", "default");

  micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    }
  });

  startLocalRecording(micStream);

  updateStatus("Opening WebSocket...", "default");

  ws = new WebSocket(signedUrl);

  ws.onopen = async () => {
    updateStatus("Connected via WebSocket", "active");

    ws.send(JSON.stringify({
      type: "conversation_initiation_client_data"
    }));

    audioCtx = new AudioContext();

    await createAudioWorklet();

    const source = audioCtx.createMediaStreamSource(micStream);
    workletNode = new AudioWorkletNode(audioCtx, "mic-processor");

    workletNode.port.onmessage = (event) => {
      handleInputSamples(event.data, audioCtx.sampleRate);
    };

    source.connect(workletNode);

    startBtn.textContent = "Stop Translation";
    startBtn.disabled = false;
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);

      debugLog(`EVENT=${msg.type || Object.keys(msg).join(",")}`);

      const userText =
        msg.user_transcript?.text ||
        msg.user_transcription_event?.user_transcript ||
        msg.transcript;

      if (userText) {
        updateStatus(`User: ${userText}`, "active");
      }

      const aiText =
        msg.agent_response?.response ||
        msg.agent_response_event?.agent_response ||
        msg.agent_response_event?.response ||
        msg.response;

      if (aiText) {
        updateStatus(`AI: ${aiText}`, "active");
      }

      if (msg.audio_event?.audio_base_64) {
        playPcm16Base64(msg.audio_event.audio_base_64);
      }

      if (msg.ping_event?.event_id) {
        ws.send(JSON.stringify({
          type: "pong",
          event_id: msg.ping_event.event_id
        }));
      }
    } catch (error) {
      debugLog(`WS parse error: ${error.message}`);
    }
  };

  ws.onerror = () => {
    updateStatus("WebSocket error", "error");
    stopTranslator();
  };

  ws.onclose = () => {
    updateStatus("Disconnected", "default");
    stopTranslator();
  };
}

async function startTranslator() {
  if (isRunning || isStarting) return;

  try {
    isRunning = true;
    isStarting = true;
    startBtn.disabled = true;

    const signedUrl = await getSignedUrl();
    debugLog(`signedUrl=${signedUrl}`);

    const mode = getEchoMode();

    if (mode === "sdk") {
      await startSdkSession(signedUrl);
    } else {
      await startWebSocketSession(signedUrl);
    }

    isStarting = false;
  } catch (error) {
    isRunning = false;
    isStarting = false;

    updateStatus(`Error: ${error.message}`, "error");

    startBtn.textContent = "Start Translation";
    startBtn.disabled = false;
  }
}

async function stopTranslator() {
  isRunning = false;
  isStarting = false;
  isAgentSpeaking = false;

  clearTimeout(agentSpeakingTimeout);
  agentSpeakingTimeout = null;

  sendUntilTime = 0;
  preRollChunks = [];
  isSendingWindowActive = false;

  if (conversation) {
    try {
      if (typeof conversation.end === "function") {
        await conversation.end();
      } else if (typeof conversation.endSession === "function") {
        await conversation.endSession();
      }
    } catch (e) {}

    conversation = null;
  }

  if (workletNode) {
    workletNode.disconnect();
    workletNode = null;
  }

  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }

  if (outputCtx) {
    outputCtx.close().catch(() => {});
    outputCtx = null;
  }

  if (recorder && recorder.state !== "inactive") {
    recorder.stop();
  }

  recorder = null;

  if (micStream) {
    micStream.getTracks().forEach(track => track.stop());
    micStream = null;
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }

  ws = null;
  pcmBuffer = [];
  nextPlayTime = 0;

  updateStatus("Disconnected", "default");

  startBtn.textContent = "Start Translation";
  startBtn.disabled = false;
}

startBtn.addEventListener("click", async () => {
  if (isRunning || conversation) {
    await stopTranslator();
  } else {
    await startTranslator();
  }
});

debugEnabledEl?.addEventListener("change", () => {
  if (!debugEnabledEl.checked && debugLogEl) {
    debugLogEl.textContent = "";
  }
});
