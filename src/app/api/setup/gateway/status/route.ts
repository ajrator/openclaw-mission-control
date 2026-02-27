import { NextResponse } from 'next/server';
import { getGatewaySetupState } from '@/lib/openclaw';

/**
 * GET /api/setup/gateway/status
 * Returns whether the gateway is configured and reachable. Used by onboarding.
 */
export async function GET() {
    const status = await getGatewaySetupState();
    const res = NextResponse.json({
        installed: status.installed,
        installMethod: status.installMethod,
        configured: status.configured,
        reachable: status.reachable,
        ready: status.ready,
        state: status.state,
        diagnostics: status.diagnostics,
    });
    res.headers.set('Cache-Control', 'no-store');
    return res;
}
