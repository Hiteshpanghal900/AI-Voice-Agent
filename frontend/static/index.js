// ================================ Generate Voice Button ================================
async function generateVoice(event) {
    event.preventDefault();

    const text = document.getElementById("text-input").value.trim();
    if (!text) {
        alert("Please enter the text to generate speech.");
        return;
    }

    try {
        const response = await fetch("http://localhost:8000/generate-voice", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text })
        });

        if (!response.ok) throw new Error("Server Error");

        const result = await response.json();
        console.log("Audio URL:", result.audio_url);

        const container = document.getElementById("audio-player-container");
        container.innerHTML = "";

        const audio = document.createElement("audio");
        audio.src = result.audio_url;
        audio.controls = true;
        audio.autoplay = true;
        audio.style.marginTop = "20px";
        audio.style.width = "70%";
        audio.style.display = "block";

        container.appendChild(audio);
    } catch (err) {
        alert("Error: " + err.message);
    }
}
