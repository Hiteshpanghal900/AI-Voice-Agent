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
let socket;

// Connect websocket
function connectWebSocket(){
  socket = new WebSocket("ws://127.0.0.1:8000/ws/audio");

  socket.onopen = () => {
    console.log("WebSocket connected");
    botStatus.textContent = "Connected. Ready to record.";
  };

  socket.onclose = () => {
    console.log("WebSocket closed");
    botStatus.textContent = "Connected closed.";
  };

  socket.onerror = (err) => {
    console.error("WebSocket error:", {err});
    botStatus.textContent = "Error connecting to server.";
  };

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data)
    const transcript = data.Transcript;
    
    try {
        addMessage(transcript, "user");
      } catch (addMessageError) {
        console.error("Error calling addMessage:", addMessageError);
      }
    };
}

// Add styles for mic button states
function setMicRecordingState(isRecording) {
  if (isRecording) {
    botStatus.textContent = "Recording...";
    micBtn.innerHTML = '<i class="bi bi-stop"></i>';
  } else {

    micBtn.style.backgroundColor = "";
    micBtn.innerHTML = '<i class="bi bi-mic-fill"></i>';
    botStatus.textContent = "Processing...";
  }
}

function addMessage(content, role) {
  const div = document.createElement("div");
  div.classList.add("message", role);
  div.textContent = content;
  messagesDiv.appendChild(div);
  scrollToBottom();
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

// Play multiple audio URLs sequentially and return a Promise that resolves when done
function playAudiosSequentially(audioUrls) {
  return new Promise((resolve) => {
    if (!audioUrls.length) {
      resolve();
      return;
    }

    let index = 0;
    const audio = new Audio();
    audio.style.display = "none";
    document.body.appendChild(audio);

    audio.src = audioUrls[index];
    audio.play();

    audio.addEventListener("ended", () => {
      index++;
      if (index < audioUrls.length) {
        audio.src = audioUrls[index];
        audio.play();
      } else {
        audio.remove();
        resolve();
      }
    });
  });
}

// Start recording 
async function startRecording(){
  if(chatEnded) return;

  try{
    stream = await navigator.mediaDevices.getUserMedia({audio: true});
    audioContext = new AudioContext({ sampleRate: 16000 }); // force 16kHz
    source = audioContext.createMediaStreamSource(stream);

    // create a processor to grab raw audio
    processor = audioContext.createScriptProcessor(4096, 1, 1);
    source.connect(processor);
    processor.connect(audioContext.destination);

    processor.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0); // Float32
      const pcm16 = floatTo16BitPCM(inputData);
      const blob = new Blob([pcm16], { type: "application/octet-stream" });
      socket.send(blob); // send raw PCM16 to backend
    };

    isRecording = true;
    botStatus.textContent = "Recording & Streaming...";
    micBtn.innerHTML = '<i class="bi bi-stop"></i>';
  } catch(err){
    console.error("Microphone access denied:", err);
    botStatus.textContent = "Microphone access denied";
  }
}


function stopRecording(){
  if (!isRecording) return;

  if (processor) {
      processor.disconnect();
      processor.onaudioprocess = null;
  }
  if (source) source.disconnect();
  if (stream) {
      stream.getTracks().forEach(track => track.stop());
  }
  if (audioContext) audioContext.close();

  // tell backend recording is finished
  socket.send(JSON.stringify({ text: "END" }));

  isRecording = false;
  botStatus.textContent = "Stopped recording.";
  micBtn.innerHTML = '<i class="bi bi-mic-fill"></i>'
}

// Mic button click handler
micBtn.addEventListener("click", () => {
  if (!isRecording) {
    startRecording();
  } else {
    stopRecording();
  }
});

// End chat button click handler
endChatBtn.addEventListener("click", () => {
  chatEnded = true;
  stopRecording();
  if (socket && socket.readyState == WebSocket.OPEN){
    socket.close();
  }
  scrollToBottom();
});

// Initial load
connectWebSocket();

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