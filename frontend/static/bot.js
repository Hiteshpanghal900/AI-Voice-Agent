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
    console.log("Server:", event.data)
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
    const stream = await navigator.mediaDevices.getUserMedia({audio: true});
    mediaRecorder = new MediaRecorder(stream, {mimeType: "audio/webm"});

    mediaRecorder.ondataavailable = (event) =>{
      if(event.data.size>0 && socket.readyState == WebSocket.OPEN){
        event.data.arrayBuffer().then(buffer => {
          socket.send(buffer);  // send binary audio chunk
        })
      }
    }

    mediaRecorder.start(250);
    isRecording = true;
    botStatus.textContent = "Recording & Streaming...";
    micBtn.innerHTML = '<i class="bi bi-stop"></i>';
  } catch(err){
    console.error("Microphone access denied:", err);
    botStatus.textContent = "Microphone access denied";
  }
}


function stopRecording(){
  if(mediaRecorder && mediaRecorder.state != "inactive"){
    mediaRecorder.stop();
    isRecording = false;
    botStatus.textContent = "Stopped recording.";
    micBtn.innerHTML = '<i class="bi bi-mic-fill"></i>'

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send("END")
      socket.close();
    }
  }
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

