// packages/frontend/src/lib/models.ts

export interface ModelOption {
  value: string;
  label: string;
}

export const PROVIDER_MODELS: Record<string, ModelOption[]> = {
  google: [
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash — fast, efficient (recommended)' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro — most capable' },
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash — legacy' },
  ],
  openai: [
    { value: 'gpt-4o', label: 'GPT-4o — recommended' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini — fast, efficient' },
    { value: 'o3-mini', label: 'o3-mini — reasoning' },
  ],
  anthropic: [
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 — recommended' },
    { value: 'claude-opus-4-6', label: 'Claude Opus 4.6 — most capable' },
    { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — fastest' },
  ],
  groq: [
    { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B — versatile' },
    { value: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B — efficient' },
  ],
};

export const PROVIDERS = [
  { value: 'google', label: 'Google Gemini' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'groq', label: 'Groq' },
] as const;

export function getModelsForProvider(provider: string): ModelOption[] {
  return PROVIDER_MODELS[provider] ?? [];
}

export function getDefaultModel(provider: string): string {
  return getModelsForProvider(provider)[0]?.value ?? '';
}
