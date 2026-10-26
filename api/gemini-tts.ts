import { createTtsEndpoint } from '../server/gemini/tts-endpoint.js';

// Fails closed unless GEMINI_PROVIDER_MODE, origin allowlist and access-code hash are configured (server/gemini/config.ts).
export default { fetch: createTtsEndpoint() };
