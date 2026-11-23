// Vorbereitung für die direkte KI-Anbindung.
//
// Noch ruft Foodfinder kein Sprachmodell auf: Die Gruppe sieht den Masterprompt und kopiert ihn.
// Zum Anbinden pro Anbieter generate() umsetzen und `connected` setzen. Für Claude:
// offizielles SDK (@anthropic-ai/sdk), Modell unten, Websuche als Server-Tool (damit
// Restaurants gefunden werden, die gerade geöffnet haben) und strukturierte Ausgabe
// passend zum JSON-Format aus prompt.js.

export const PROVIDERS = {
  claude: { label: 'Claude', model: 'claude-opus-5-5', keyEnv: 'ANTHROPIC_API_KEY' },
  chatgpt: { label: 'ChatGPT', model: null, keyEnv: 'OPENAI_API_KEY' },
  gemini: { label: 'Gemini', model: null, keyEnv: 'GEMINI_API_KEY' },
};

export const DEFAULT_PROVIDER = PROVIDERS[process.env.LLM_PROVIDER] ? process.env.LLM_PROVIDER : 'claude';

// Was die Oberfläche über die KI-Anbindung wissen muss
export function aiInfo() {
  return {
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label })),
    default: DEFAULT_PROVIDER,
    connected: false,
  };
}

export async function generate(prompt, providerId = DEFAULT_PROVIDER) {
  if (!PROVIDERS[providerId]) throw new Error(`Unbekannter Anbieter: ${providerId}`);
  throw new Error('Die KI ist noch nicht angebunden. Bis dahin den Masterprompt kopieren.');
}
