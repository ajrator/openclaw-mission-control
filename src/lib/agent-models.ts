/** Normalize fallback models: trim, remove empties/duplicates, and exclude the primary model. */
export function sanitizeAgentFallbacks(primary: string | undefined, fallbacks: unknown): string[] {
    const primaryTrimmed = typeof primary === 'string' ? primary.trim() : '';
    const seen = new Set<string>();
    const result: string[] = [];
    const list = Array.isArray(fallbacks) ? fallbacks : [];
    for (const raw of list) {
        if (typeof raw !== 'string') continue;
        const value = raw.trim();
        if (!value) continue;
        if (primaryTrimmed && value === primaryTrimmed) continue;
        if (seen.has(value)) continue;
        seen.add(value);
        result.push(value);
    }
    return result;
}
