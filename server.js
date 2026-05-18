import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

app.get("/api/get-signed-url", async (req, res) => {
  try {
    if (!process.env.ELEVENLABS_API_KEY) {
      return res.status(500).json({
        error: "ELEVENLABS_API_KEY is not set"
      });
    }

    if (!process.env.AGENT_ID) {
      return res.status(500).json({
        error: "AGENT_ID is not set"
      });
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${process.env.AGENT_ID}`,
      {
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY
        }
      }
    );

    if (!response.ok) {
      const errorText = await response.text();

      throw new Error(
        `ElevenLabs API error: ${response.status} ${errorText}`
      );
    }

    const data = await response.json();

    res.json({
      signedUrl: data.signed_url
    });

  } catch (error) {
    res.status(500).json({
      error: error.message || "Authentication failed"
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
