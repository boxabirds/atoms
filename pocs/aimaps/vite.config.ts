import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'http';

// ---------------------------------------------------------------------------
// Gemini API helpers
// ---------------------------------------------------------------------------

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const SEAMLESS_SUFFIX =
  ' CRITICAL: The image MUST tile seamlessly — left edge pixel-continuous' +
  ' with right edge, top with bottom. Use smooth gradients near all four' +
  ' edges so they blend naturally when tiled. Generate only the image, no text.';

/** Per-map-type prompt prefixes */
const MAP_PROMPT_PREFIXES: Record<string, string> = {
  displacement:
    'Create a seamless tileable square GRAYSCALE displacement/height map.' +
    ' White areas are elevated/high, black areas are low/recessed.' +
    SEAMLESS_SUFFIX +
    ' The surface represents:',
  albedo:
    'Create a seamless tileable square COLOR texture showing ONLY the base' +
    ' surface color (albedo). No shadows, no lighting, no reflections — just' +
    ' flat diffuse color.' +
    SEAMLESS_SUFFIX +
    ' The surface represents:',
  roughness:
    'Create a seamless tileable square GRAYSCALE roughness map.' +
    ' White = rough/matte, black = smooth/mirror-like.' +
    SEAMLESS_SUFFIX +
    ' The surface represents:',
  metalness:
    'Create a seamless tileable square GRAYSCALE metalness map.' +
    ' White = metallic, black = non-metal/dielectric.' +
    SEAMLESS_SUFFIX +
    ' The surface represents:',
  emissive:
    'Create a seamless tileable square RGB emissive/glow map.' +
    ' Colored areas emit light; black = no emission.' +
    SEAMLESS_SUFFIX +
    ' The surface represents:',
};

/** System prompt for the discriminator (material recipe extraction) */
const DISCRIMINATOR_SYSTEM =
  `You are a PBR material analyst. Given a surface description, decompose it ` +
  `into physically-based rendering components.\n\n` +
  `For each of these map types, decide if a TEXTURE MAP is needed (the property ` +
  `varies spatially) or if a SCALAR value suffices (the property is uniform):\n` +
  `- displacement: surface height/geometry variation (grayscale)\n` +
  `- albedo: base surface color (RGB)\n` +
  `- roughness: surface smoothness variation (0=mirror, 1=rough)\n` +
  `- metalness: metallic vs dielectric (0=plastic, 1=metal)\n` +
  `- emissive: self-illumination/glow (RGB) — only if description implies glow/lava/neon/luminescence\n\n` +
  `Rules:\n` +
  `- Normal maps are NEVER generated — always derived from displacement.\n` +
  `- If a property is uniform, set its scalar and do NOT include it in mapsToGenerate.\n` +
  `- If it varies spatially, include it in mapsToGenerate with a vivid description in mapDescriptions.\n` +
  `- For ALBEDO specifically: if the color is uniform (e.g. "gold"), set baseColor to a hex string (e.g. "#FFD700") and do NOT include albedo in mapsToGenerate. If the color varies spatially (e.g. "rusty gold"), include albedo in mapsToGenerate AND set baseColor to null.\n` +
  `- ALWAYS set baseColor to SOMETHING unless an albedo map is being generated. The user's color intent must be captured either way.\n` +
  `- Displacement is skipped for smooth/flat surfaces.\n` +
  `- Emissive is skipped unless the description implies light emission.\n` +
  `- displacementScale range: 0.05 (subtle) to 0.3 (dramatic).\n` +
  `- transmission: 0=opaque, 0.3-0.8=translucent, 1.0=fully transparent glass.\n` +
  `- ior: glass≈1.5, water≈1.33, diamond≈2.42.\n\n` +
  `Return ONLY valid JSON matching this schema (no markdown fences):\n` +
  `{\n` +
  `  "mapsToGenerate": ["displacement", ...],\n` +
  `  "mapDescriptions": { "displacement": "...", "albedo": "..." },\n` +
  `  "scalars": {\n` +
  `    "roughness": 0.5,\n` +
  `    "metalness": 0.0,\n` +
  `    "transmission": 0,\n` +
  `    "thickness": 0,\n` +
  `    "ior": 1.5,\n` +
  `    "displacementScale": 0.15,\n` +
  `    "baseColor": "#FFD700",\n` +
  `    "emissiveIntensity": 0,\n` +
  `    "emissiveColor": null\n` +
  `  }\n` +
  `}`;

// ---------------------------------------------------------------------------
// Request body parsing helper
// ---------------------------------------------------------------------------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

function geminiPlugin(env: Record<string, string>): Plugin {
  const apiKey = env.GEMINI_API_KEY;
  const imageModel = env.GEMINI_MODEL_ID;
  const liteModel = env.GEMINI_FLASH_LITE_MODEL_ID;

  function assertEnv() {
    if (!apiKey) throw new Error('GEMINI_API_KEY not set in .env');
    if (!imageModel) throw new Error('GEMINI_MODEL_ID not set in .env');
    if (!liteModel) throw new Error('GEMINI_FLASH_LITE_MODEL_ID not set in .env');
  }

  return {
    name: 'gemini-api',
    configureServer(server) {
      // ── POST /api/analyze ── discriminator (text → MaterialRecipe JSON)
      server.middlewares.use('/api/analyze', async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
        try {
          assertEnv();
          const { prompt } = JSON.parse(await readBody(req));

          const url = `${GEMINI_BASE}/${liteModel}:generateContent?key=${apiKey}`;
          const geminiRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: DISCRIMINATOR_SYSTEM }] },
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                responseMimeType: 'application/json',
              },
            }),
          });

          const data = await geminiRes.json();

          // Extract the JSON text from Gemini's response
          const text =
            data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

          // Parse and forward the recipe (validate it's real JSON)
          const recipe = JSON.parse(text);
          sendJson(res, 200, recipe);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          sendJson(res, 500, { error: msg });
        }
      });

      // ── POST /api/generate-map ── image generation per map type
      server.middlewares.use('/api/generate-map', async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
        try {
          assertEnv();
          const { type, description } = JSON.parse(await readBody(req));

          const prefix = MAP_PROMPT_PREFIXES[type];
          if (!prefix) throw new Error(`Unknown map type: ${type}`);

          const url = `${GEMINI_BASE}/${imageModel}:generateContent?key=${apiKey}`;
          const geminiRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: `${prefix} ${description}` }] }],
              generationConfig: {
                responseModalities: ['IMAGE', 'TEXT'],
              },
            }),
          });

          const data = await geminiRes.json();
          sendJson(res, 200, data);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          sendJson(res, 500, { error: msg });
        }
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Vite config
// ---------------------------------------------------------------------------

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react(), geminiPlugin(env)],
    server: { port: 3030 },
  };
});
