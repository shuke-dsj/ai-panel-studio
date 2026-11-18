const token = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export function usageMetadata(value: unknown) {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const usage: Record<string, number | { cached_tokens: number }> = {};
  for (const key of [
    'prompt_tokens',
    'completion_tokens',
    'total_tokens',
    'prompt_cache_hit_tokens',
    'prompt_cache_miss_tokens',
  ])
    if (token(input[key])) usage[key] = input[key];
  const details = input.prompt_tokens_details as Record<string, unknown> | undefined;
  if (details && token(details.cached_tokens))
    usage.prompt_tokens_details = { cached_tokens: details.cached_tokens };
  const hit = token(input.prompt_cache_hit_tokens)
    ? input.prompt_cache_hit_tokens
    : details && token(details.cached_tokens)
      ? details.cached_tokens
      : undefined;
  const miss = token(input.prompt_cache_miss_tokens)
    ? input.prompt_cache_miss_tokens
    : hit !== undefined && token(input.prompt_tokens) && hit <= input.prompt_tokens
      ? input.prompt_tokens - hit
      : undefined;
  const complete =
    hit !== undefined &&
    miss !== undefined &&
    (!token(input.prompt_tokens) || hit + miss === input.prompt_tokens);
  return {
    usage,
    cache: {
      status: hit === undefined ? 'not_reported' : complete ? 'reported' : 'incomplete',
      ...(hit !== undefined ? { hitTokens: hit } : {}),
      ...(miss !== undefined ? { missTokens: miss } : {}),
      ...(complete && hit + miss > 0 ? { hitRate: hit / (hit + miss) } : {}),
    },
  };
}
