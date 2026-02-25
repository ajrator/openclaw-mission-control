import { NextResponse } from 'next/server';
import { isOnboardingCompleted } from '@/lib/mission-control-prefs';

/**
 * GET /api/setup/onboarding/status
 * Returns whether onboarding has been completed. Used by layout to decide redirect.
 */
export async function GET() {
    return NextResponse.json({ completed: isOnboardingCompleted() });
}
