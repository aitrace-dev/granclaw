// packages/frontend/src/lib/models.ts

export interface ModelOption {
  value: string;
  label: string;
}

export const PROVIDER_MODELS: Record<string, ModelOption[]> = {
  google: [
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash — fast + smart (recommended)' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro — most capable' },
    { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite — cheapest' },
    { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash — preview' },
    { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro — preview' },
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash — previous gen' },
  ],
  openai: [
    { value: 'gpt-4.1', label: 'GPT-4.1 — recommended, 1M ctx' },
    { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini — fast, efficient' },
    { value: 'gpt-4.1-nano', label: 'GPT-4.1 Nano — cheapest' },
    { value: 'gpt-5.4', label: 'GPT-5.4 — latest flagship' },
  ],
  anthropic: [
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 — recommended' },
    { value: 'claude-opus-4-6', label: 'Claude Opus 4.6 — most capable' },
    { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — fastest' },
  ],
  groq: [
    { value: 'meta-llama/llama-4-maverick-17b-128e-instruct', label: 'Llama 4 Maverick — latest, 128 experts' },
    { value: 'meta-llama/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout — fast, 16 experts' },
    { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B — versatile' },
    { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B — fastest/cheapest' },
  ],
  openrouter: [
    { value: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash — fast, 1M ctx (free tier)' },
    { value: 'deepseek/deepseek-v3.2', label: 'DeepSeek V3.2 — fast, efficient' },
    { value: 'xiaomi/mimo-v2-pro', label: 'MiMo V2 Pro — agentic, 1T params' },
    { value: 'qwen/qwen3.6-plus', label: 'Qwen 3.6 Plus — throughput leader' },
    { value: 'minimax/minimax-m2.7', label: 'MiniMax M2.7 — agentic' },
    { value: 'x-ai/grok-4', label: 'Grok 4 — reasoning, 256k ctx' },
  ],
};

export const PROVIDERS = [
  { value: 'google', label: 'Google Gemini' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'groq', label: 'Groq' },
  { value: 'openrouter', label: 'OpenRouter' },
] as const;

export function getModelsForProvider(provider: string): ModelOption[] {
  return PROVIDER_MODELS[provider] ?? [];
}

export function getDefaultModel(provider: string): string {
  return getModelsForProvider(provider)[0]?.value ?? '';
}
