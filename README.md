#### 🚀 Multilingual Real-Time Voice Translation App with Predefined & Cloned Voices using ElevenLabs AI

I built a real-time multilingual voice translation app powered by ElevenLabs Generative AI, translating speech instantly with lifelike, expressive voices. The demo shows how to use predefined voices and instant voice cloning, and we explore the ElevenLabs dashboard to create, manage, and connect voices to AI agents easily.

The backend securely generates a signed URL, while the frontend connects to ElevenLabs’ Conversational AI for live translation using predefined agent configurations. WebSocket communication is handled transparently by the ElevenLabs client library, so no direct WebSocket code is required.

Showcases real-time translation across multiple languages (English, Russian, Chinese, and Spanish), using both predefined AI voices and cloned human voices — including the ability to hear translations spoken back in your own voice.

The ElevenLabs Starter plan features Instant Voice Cloning, allowing you to clone your voice with just a 10-second audio sample, and Professional Voice Cloning, which produces the most realistic, lifelike replica of your voice using at least 30 minutes of clean audio. For this app, we’ll be using Instant Voice Cloning.

#### 👉 Links & Resources

- [ElevenLabs](https://elevenlabs.io/)
---

#### 🚀 Clone and Run

```bash
# Clone the repository
git clone https://github.com/Ashot72/multilingual-voice-translation-elevenlabs

# Navigate into the project directory
cd multilingual-voice-translation-elevenlabs

# Copy .env.example to create a new .env file, then add your ELEVENLABS_API_KEY and AGENT_IDs.
cp .env.example .env

# Install dependencies
npm install

# Start the development server
npm start

# The app will be available at http://localhost:3000
```
📺 **Video:** [Watch on YouTube](https://youtu.be/gPobJy4RmUo)
