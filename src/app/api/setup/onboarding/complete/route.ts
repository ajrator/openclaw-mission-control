import { NextResponse } from 'next/server';
import { writeMissionControlPrefs } from '@/lib/mission-control-prefs';

/**
 * POST /api/setup/onboarding/complete
 * Marks onboarding as completed. Body: { skippedNotion?: boolean, skippedOpenAI?: boolean }.
 */
export async function POST(request: Request) {
    let skippedNotion: boolean | undefined;
    let skippedOpenAI: boolean | undefined;
    try {
        const body = await request.json();
        if (body && typeof body === 'object') {
            skippedNotion = body.skippedNotion === true;
            skippedOpenAI = body.skippedOpenAI === true;
        }
    } catch {
        /* no body or invalid JSON */
    }
    const updates: Parameters<typeof writeMissionControlPrefs>[0] = {
        onboardingCompletedAt: new Date().toISOString(),
    };
    if (skippedNotion === true) updates.onboardingSkippedNotion = true;
    if (skippedOpenAI === true) updates.onboardingSkippedOpenAI = true;
    writeMissionControlPrefs(updates);
    return NextResponse.json({ ok: true });
}
