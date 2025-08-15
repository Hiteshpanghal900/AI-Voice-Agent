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

// Start recording function
async function startRecording() {
  if (chatEnded) return;

  audioChunks = [];
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.start();
    isRecording = true;
    setMicRecordingState(true);
    micBtn.disabled = false;
    endChatBtn.disabled = false;

    mediaRecorder.addEventListener("dataavailable", event => {
      if (event.data.size > 0) audioChunks.push(event.data);
    });

    mediaRecorder.addEventListener("stop", async () => {
      if (chatEnded) return;

      const formData = new FormData();
      const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
      formData.append("audio", audioBlob, "recording.webm");

      micBtn.disabled = true;
      endChatBtn.disabled = true;

      try {
        const res = await fetch(`/agent/chat/${sessionId}`, {
          method: "POST",
          body: formData
        });

        if (!res.ok) {
          throw new Error("Server error");
        }

        const result = await res.json();
        if (result.history) {
          messagesDiv.innerHTML = ""; // Clear all messages
          result.history.forEach(msg => {
            addMessage(msg.content, msg.role);
          });
          scrollToBottom();
        }

        if (result.audio_urls && result.audio_urls.length > 0) {
          await playAudiosSequentially(result.audio_urls);
        }
      } catch (err) {
        console.error("Error sending audio:", err);
      } finally {
        if (!chatEnded) {
          micBtn.disabled = false;
          endChatBtn.disabled = false;
          setMicRecordingState(false);
          // Auto start recording again after audio finished playing
          startRecording();
        }
        if (botStatus) botStatus.textContent = "";
      }
    });

  } catch (err) {
    console.error("Microphone access denied or error:", err);
    if (botStatus) botStatus.textContent = "Microphone access denied";
    setMicRecordingState(false);
  }
}

// Mic button click handler
micBtn.addEventListener("click", () => {
  if (chatEnded) return;

  if (!isRecording) {
    startRecording();
  } else {
    mediaRecorder.stop();
    isRecording = false;
    setMicRecordingState(false);
  }
});

// End chat button click handler
endChatBtn.addEventListener("click", () => {
  chatEnded = true;
  if (isRecording && mediaRecorder) {
    mediaRecorder.stop();
    isRecording = false;
  }
  micBtn.disabled = true;
  endChatBtn.disabled = true;
  if (botStatus) botStatus.textContent = "Chat ended.";
  addMessage("Chat session has ended. Thank you!", "assistant");
  scrollToBottom();
});

// Initial load
loadHistory();

