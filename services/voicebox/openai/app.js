import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const config = {
  VOICEBOX_API_URL: process.env.VOICEBOX_API_URL,
  DEFAULT_VOICE: process.env.DEFAULT_VOICE || "",
  // Voicebox's /generate defaults to the 1.7B model when model_size is
  // omitted, which OOMs on typical CPU hosts. Reuse the same
  // HARBOR_VOICEBOX_DEFAULT_MODEL_SIZE Harbor already patches the browser
  // form to, so raw API calls through this bridge get the same safe default.
  MODEL_SIZE: process.env.MODEL_SIZE || "",
  PORT: process.env.PORT || 3000,
};

if (!config.VOICEBOX_API_URL) throw new Error("VOICEBOX_API_URL is required.");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range,Authorization",
  "Access-Control-Max-Age": "86400",
};

async function fetchProfiles() {
  const resp = await fetch(`${config.VOICEBOX_API_URL}/profiles`);
  if (!resp.ok) {
    throw new Error(`Voicebox /profiles responded with status ${resp.status}`);
  }
  return resp.json();
}

// Reuses the voice-mapping strategy Voicebox's own (unimplemented) OpenAI-compat
// plan specced: case-insensitive match on profile name, an explicit "profile:<id>"
// override, then a configurable default.
function matchProfile(voice, profiles) {
  if (!voice) return null;

  const explicit = /^profile:(.+)$/i.exec(voice);
  if (explicit) {
    const id = explicit[1];
    return profiles.find((p) => p.id === id) || { id, name: id, language: "en" };
  }

  const lower = voice.toLowerCase();
  return profiles.find((p) => p.name.toLowerCase() === lower) || null;
}

function resolveProfile(voice, profiles) {
  return (
    matchProfile(voice, profiles) ||
    matchProfile(config.DEFAULT_VOICE, profiles) ||
    profiles[0] ||
    null
  );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Voicebox generation is async: /generate returns as soon as the job is
// queued, and audio only becomes fetchable once it finishes. Poll with
// backoff instead of consuming the SSE status stream, since OpenAI's
// /v1/audio/speech contract is a single blocking request/response.
async function pollForAudio(generationId, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  let delay = 500;
  let lastNetworkError = null;
  while (Date.now() < deadline) {
    let resp;
    try {
      resp = await fetch(`${config.VOICEBOX_API_URL}/audio/${generationId}`);
    } catch (err) {
      // Transient network hiccup (connection reset, etc.) during a long
      // generation — keep polling rather than failing the whole request.
      lastNetworkError = err;
      await sleep(delay);
      delay = Math.min(delay * 1.5, 5000);
      continue;
    }
    if (resp.ok) return resp;
    if (resp.status !== 404) {
      // A real error status, not "not ready yet" — fail fast, don't retry.
      throw new Error(`Voicebox /audio/${generationId} responded with status ${resp.status}`);
    }
    await sleep(delay);
    delay = Math.min(delay * 1.5, 5000);
  }
  throw (
    lastNetworkError ||
    new Error(`Timed out waiting for Voicebox to finish generating ${generationId}`)
  );
}

const app = express();
app.use(bodyParser.json());

app.use((req, res, next) => {
  res.set(corsHeaders);
  if (req.method === "OPTIONS") return res.status(204).end();
  console.log("Request Method:", req.method, "Request Path:", req.path);
  next();
});

app.get("/", (_, res) => {
  res.send(`
    <html>
      <head><title>VOICEBOX2OPENAI</title></head>
      <body>
        <h1>Voicebox2OpenAI</h1>
        <p>Congratulations! Your project has been successfully deployed.</p>
      </body>
    </html>
  `);
});

app.get("/v1/voices", async (req, res) => {
  try {
    const profiles = await fetchProfiles();
    res.json({
      voices: profiles.map((p) => ({ id: p.name, name: p.name, language: p.language })),
    });
  } catch (error) {
    console.error("Error listing voices:", error);
    res.status(500).json({ error: { message: error.message || "Failed to list voices." } });
  }
});

app.post("/v1/audio/speech", async (req, res) => {
  try {
    const { input, voice, response_format, speed } = req.body;

    if (!input) {
      return res.status(400).json({ error: { message: "Missing required field: input" } });
    }
    if (response_format && response_format !== "wav") {
      // Voicebox only emits wav; every other response_format is silently ignored.
      console.warn(`response_format "${response_format}" is not supported, returning wav`);
    }
    if (speed && speed !== 1) {
      console.warn(`speed "${speed}" is not supported by Voicebox, ignoring`);
    }

    const profiles = await fetchProfiles();
    const profile = resolveProfile(voice, profiles);
    if (!profile) {
      return res.status(400).json({
        error: {
          message:
            "No voice profiles exist in Voicebox. Create one in the Voicebox UI first, then retry.",
        },
      });
    }

    // /generate's `engine` defaults to "qwen" server-side regardless of the
    // profile's own binding, so a preset profile pinned to another engine
    // (e.g. Kokoro) must have that engine passed explicitly or generation
    // 400s with an engine mismatch. model_size is Qwen-specific, so only
    // send it when the resolved engine actually is Qwen.
    const engine = profile.preset_engine || profile.default_engine || undefined;
    const usesQwen = !engine || engine === "qwen";
    const genRequestBody = {
      profile_id: profile.id,
      text: input,
      language: profile.language || "en",
      ...(engine ? { engine } : {}),
      ...(usesQwen && config.MODEL_SIZE ? { model_size: config.MODEL_SIZE } : {}),
      // If the profile has a personality prompt set, opt into Voicebox's
      // in-character text rewrite — OpenAI's TTS request shape has no field
      // for this, so it's inferred from the profile rather than the caller.
      ...(profile.personality ? { personality: true } : {}),
    };
    console.log("Sent to Voicebox API:", JSON.stringify(genRequestBody));

    const genResp = await fetch(`${config.VOICEBOX_API_URL}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(genRequestBody),
    });
    if (!genResp.ok) {
      throw new Error(`Voicebox /generate responded with status ${genResp.status}`);
    }
    const generation = await genResp.json();

    // /generate returns as soon as the job is queued, not once audio exists —
    // Voicebox's own UI polls an SSE status stream for this; we just poll the
    // audio endpoint itself with backoff, since OpenAI's /v1/audio/speech is
    // expected to block until the bytes are ready.
    const audioResp = await pollForAudio(generation.id);

    res.set("Content-Type", audioResp.headers.get("content-type") || "audio/wav");
    audioResp.body.pipe(res);
  } catch (error) {
    console.error("Error generating speech:", error);
    res
      .status(500)
      .json({ error: { message: error.message || "An error occurred while processing the request." } });
  }
});

app.listen(config.PORT, () => console.log(`Server running on port ${config.PORT}`));

process.on("SIGINT", () => {
  console.info("Interrupted");
  process.exit(0);
});
