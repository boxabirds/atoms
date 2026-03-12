import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const DISPLACEMENT_PROMPT_PREFIX =
  'Create a perfectly tileable square grayscale displacement map for 3D texturing.' +
  ' White areas are elevated/high, black areas are low/recessed.' +
  ' CRITICAL: The image MUST tile seamlessly — the left edge must be pixel-continuous' +
  ' with the right edge, and the top edge must be pixel-continuous with the bottom edge.' +
  ' When placed side by side or wrapped around a 3D surface, there must be zero visible seams.' +
  ' Use smooth gradients near all four edges so they blend naturally when tiled.' +
  ' Generate only the image, no text. The surface represents:';

function geminiProxy(env: Record<string, string>): Plugin {
  const apiKey = env.GEMINI_API_KEY;
  const modelId = env.GEMINI_MODEL_ID;

  return {
    name: 'gemini-proxy',
    configureServer(server) {
      server.middlewares.use('/api/generate', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', async () => {
          try {
            const { prompt } = JSON.parse(Buffer.concat(chunks).toString());

            if (!apiKey || !modelId) {
              throw new Error('GEMINI_API_KEY or GEMINI_MODEL_ID not set in .env');
            }

            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

            const geminiRes = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [
                  {
                    parts: [
                      { text: `${DISPLACEMENT_PROMPT_PREFIX} ${prompt}` },
                    ],
                  },
                ],
                generationConfig: {
                  responseModalities: ['IMAGE', 'TEXT'],
                },
              }),
            });

            const data = await geminiRes.json();
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
          } catch (err: unknown) {
            const message =
              err instanceof Error ? err.message : 'Unknown error';
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: message }));
          }
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react(), geminiProxy(env)],
    server: { port: 3030 },
  };
});
