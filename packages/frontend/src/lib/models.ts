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
  ],
  openai: [
    { value: 'gpt-4.1', label: 'GPT-4.1 — recommended, 1M ctx' },
    { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini — fast, efficient' },
    { value: 'gpt-4.1-nano', label: 'GPT-4.1 Nano — cheapest' },
  ],
  anthropic: [
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 — recommended' },
    { value: 'claude-opus-4-6', label: 'Claude Opus 4.6 — most capable' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 — fastest' },
  ],
  groq: [
    // Llama 4 Maverick deprecated Mar 9 2026; Scout deprecated Apr 2025 — removed
    { value: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B — flagship, ~500 tok/s' },
    { value: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B — fast, efficient' },
    { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B — versatile' },
    { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B — fastest/cheapest' },
  ],
  openrouter: [
    { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash — best price/perf ($0.30/$2.50 /M)' },
    { value: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash — fast, 1M ctx ($0.50/$3 /M)' },
    { value: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro — frontier ($2/$12 /M)' },
    { value: 'deepseek/deepseek-v3.2', label: 'DeepSeek V3.2 — cheap output ($0.26/$0.38 /M)' },
    { value: 'xiaomi/mimo-v2-pro', label: 'MiMo V2 Pro — agentic, 1T params ($1/$3 /M)' },
    { value: 'qwen/qwen3.6-plus', label: 'Qwen 3.6 Plus — throughput leader ($0.33/$1.95 /M)' },
    { value: 'minimax/minimax-m2.7', label: 'MiniMax M2.7 — agentic ($0.30/$1.20 /M)' },
    { value: 'x-ai/grok-4', label: 'Grok 4 — reasoning, 256k ctx ($3/$15 /M)' },
  ],
  // Enterprise-managed provider — routes through the internal LLM proxy.
  // Not listed in PROVIDERS (users cannot add it manually).
  freetier: [
    { value: 'z-ai/glm-5-turbo', label: 'GLM 5 Turbo — enterprise default' },
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
