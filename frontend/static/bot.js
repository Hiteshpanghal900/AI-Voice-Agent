const urlParams = new URLSearchParams(window.location.search);
const sessionId = urlParams.get("session_id");

const messagesDiv = document.getElementById("messages");
const micBtn = document.getElementById("micBtn");
const botStatus = document.getElementById("botStatus");
const endChatBtn = document.getElementById("endChatBtn");

let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let chatEnded = false;
let isPlaying = false;
let socket, murfSocket, stream, audioContext, source, processor;

// Audio playback queue and state
let audioQueue = [];
let currentAudio = null;
let audioPlaybackComplete = false;

// Connect websocket
function connectWebSocket(){
  socket = new WebSocket("ws://127.0.0.1:8000/ws/audio");
  socket.onopen = () => {
    console.log("WebSocket connected! Ready to send audio");
    botStatus.textContent = "Connected. Ready to record.";
  };

  socket.onclose = () => {
    console.log("WebSocket closed");
    botStatus.textContent = "Connection closed.";
  };

  socket.onerror = (err) => {
    console.error("WebSocket error:", err);
    botStatus.textContent = "Error connecting to server.";
  };

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    
    try {
      if(data.type === "transcript"){
        if(data.userType === "user"){
          addMessage(data.transcript, "user");
        } else {
          addMessage(data.text, "assistant");
        }
      }

      if(data.type === "audio_chunk"){
        console.log("[Client] Received audio chunk");
        handleAudioChunk(data.data);
      }

      if(data.type === "end_of_audio"){
        console.log("[Client] Audio stream complete");
        audioPlaybackComplete = true;
        // If no audio is currently playing, try to play any remaining chunks
        if (!isPlaying) {
          processAudioQueue();
        }
      }

      if(data.type === "end_of_llm"){
        console.log("[Client] LLM Streaming completed");
        endAssistantMessage();
      }

    } catch (error) {
      console.error("Error processing message:", error);
    }
  };
}

// Improved audio handling
function handleAudioChunk(base64Data) {
  try {
    const arrayBuffer = base64ToArrayBuffer(base64Data);
    audioQueue.push(arrayBuffer);
    
    // Start processing queue if not already playing
    if (!isPlaying) {
      processAudioQueue();
    }
  } catch (error) {
    console.error("Error handling audio chunk:", error);
  }
}

async function processAudioQueue() {
  if (isPlaying || audioQueue.length === 0) return;
  
  isPlaying = true;
  
  try {
    // Combine all available chunks for better playback
    const chunksToPlay = [...audioQueue];
    audioQueue = []; // Clear the queue
    
    if (chunksToPlay.length > 0) {
      await playAudioChunks(chunksToPlay);
    }
  } catch (error) {
    console.error("Error processing audio queue:", error);
  }
  
  isPlaying = false;
  
  // Check if there are more chunks to play
  if (audioQueue.length > 0) {
    setTimeout(() => processAudioQueue(), 100);
  }
}

async function playAudioChunks(chunks) {
  try {
    // Create a single blob from all chunks
    const combinedBlob = new Blob(chunks, { type: "audio/mpeg" });
    const audioUrl = URL.createObjectURL(combinedBlob);
    
    const audio = new Audio(audioUrl);
    
    // Set up audio properties for better compatibility
    audio.preload = "auto";
    audio.volume = 1.0;
    
    return new Promise((resolve, reject) => {
      audio.oncanplaythrough = () => {
        console.log("[Client] Audio ready to play");
      };
      
      audio.onended = () => {
        console.log("[Client] Audio playback ended");
        URL.revokeObjectURL(audioUrl);
        resolve();
      };
      
      audio.onerror = (error) => {
        console.error("[Client] Audio playback error:", error);
        URL.revokeObjectURL(audioUrl);
        reject(error);
      };
      
      audio.onloadeddata = () => {
        console.log("[Client] Audio data loaded, starting playback");
        audio.play().catch(playError => {
          console.error("[Client] Play failed:", playError);
          reject(playError);
        });
      };
      
      // Load the audio
      audio.load();
    });
    
  } catch (error) {
    console.error("[Client] Error creating audio:", error);
    throw error;
  }
}

function base64ToArrayBuffer(base64) {
  try {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  } catch (error) {
    console.error("Error decoding base64:", error);
    throw error;
  }
}

// Alternative audio playback method using Web Audio API (fallback)
async function playAudioWithWebAPI(chunks) {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Combine all chunks
    const combinedBlob = new Blob(chunks, { type: "audio/mpeg" });
    const arrayBuffer = await combinedBlob.arrayBuffer();
    
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const source = audioContext.createBufferSource();
    
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    
    return new Promise((resolve) => {
      source.onended = () => {
        audioContext.close();
        resolve();
      };
      source.start(0);
    });
    
  } catch (error) {
    console.error("Web Audio API playback failed:", error);
    throw error;
  }
}

let currentAssistantMessage = null;
function addMessage(content, role) {
  // Hide empty state when first message is added
  const emptyState = messagesDiv.querySelector('.empty-state');
  if (emptyState) {
    emptyState.style.display = 'none';
  }
  
  if (role === "user") {
    const div = document.createElement("div");
    div.classList.add("message", role);
    div.textContent = content;
    messagesDiv.appendChild(div);
    scrollToBottom();
  } else {
    if (!currentAssistantMessage) {
      currentAssistantMessage = document.createElement("div");
      currentAssistantMessage.classList.add("message", role);
      messagesDiv.appendChild(currentAssistantMessage);
    }
    currentAssistantMessage.textContent += content;
    scrollToBottom();
  }
}

function endAssistantMessage() {
  currentAssistantMessage = null;
}

function scrollToBottom() {
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Load chat history on page load
async function loadHistory() {
  try {
    const res = await fetch(`/agent/chat/${sessionId}/history`);
    if (!res.ok) throw new Error("Failed to load history");
    const data = await res.json();

    if (data.history) {
      data.history.forEach(msg => {
        addMessage(msg.content, msg.role);
      });
      scrollToBottom();
    }
  } catch (err) {
    console.warn("No previous history found.", err);
  }
}

// ---------------------------------
// Recording functions
// ---------------------------------

// Start recording 
async function startRecording() {
  if (chatEnded) return;

  try {
    // Reset audio state when starting new recording
    audioQueue = [];
    audioPlaybackComplete = false;
    isPlaying = false;
    
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    
    audioContext = new AudioContext({ sampleRate: 16000 });
    source = audioContext.createMediaStreamSource(stream);

    // create a processor to grab raw audio
    processor = audioContext.createScriptProcessor(4096, 1, 1);
    source.connect(processor);
    processor.connect(audioContext.destination);

    processor.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0);
      const pcm16 = floatTo16BitPCM(inputData);
      
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(pcm16);
      }
    };

    isRecording = true;
    botStatus.textContent = "Recording & Streaming...";
    micBtn.classList.add('recording');
    micBtn.innerHTML = '<i class="bi bi-stop-fill"></i>';
    
  } catch (err) {
    console.error("Microphone access denied:", err); 
    botStatus.textContent = "Microphone access denied";
  }
}

function stopRecording() {
  if (!isRecording) return;

  if (processor) {
    processor.disconnect();
    processor.onaudioprocess = null;
  }
  if (source) source.disconnect();
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
  }
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close();
  }

  // tell backend recording is finished
  console.log("END Recording");
  if (socket.readyState === WebSocket.OPEN) {
    socket.send("STOP");
  }

  isRecording = false;
  botStatus.textContent = "Processing...";
  micBtn.classList.remove('recording');
  micBtn.innerHTML = '<i class="bi bi-mic-fill"></i>';
}

// -------------------------------------
// Event handlers
// -------------------------------------

// Mic button click handler
micBtn.addEventListener("click", () => {
  console.log("Mic button clicked");

  if (chatEnded) return;

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    connectWebSocket();
    // Wait a moment for connection before starting recording
    setTimeout(() => {
      if (!isRecording) {
        startRecording();
      }
    }, 500);
    return;
  }

  if (!isRecording) {
    startRecording();
  } else {
    stopRecording();
  }
});

// End chat button click handler
endChatBtn.addEventListener("click", () => {
  chatEnded = true;
  
  // Stop any ongoing recording
  if (isRecording) {
    stopRecording();
  }
  
  // Clean up audio resources
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  
  // Clear audio queue
  audioQueue = [];
  isPlaying = false;
  
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send("END");
    socket.close();
  }
  
  botStatus.textContent = "Chat ended.";
  micBtn.disabled = true;
  endChatBtn.disabled = true;
});

function floatTo16BitPCM(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return buffer;
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  loadHistory();
  connectWebSocket();
});