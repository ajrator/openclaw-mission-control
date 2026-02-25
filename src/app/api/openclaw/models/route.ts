import { NextResponse } from 'next/server';
import { getModelsWithProviders, getProvidersAndUnavailableModels, PROVIDER_PLATFORM_URLS } from '@/lib/openclaw';

export async function GET() {
    try {
        const models = getModelsWithProviders();
        const withPlatformUrl = models.map((m) => ({
            ...m,
            platformUrl: PROVIDER_PLATFORM_URLS[m.providerKey] ?? null,
        }));
        const availableToAdd = getProvidersAndUnavailableModels();
        return NextResponse.json({ models: withPlatformUrl, availableToAdd });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
