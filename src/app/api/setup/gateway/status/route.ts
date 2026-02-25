import { NextResponse } from 'next/server';
import { getGatewayUrl, isGatewayReachable } from '@/lib/openclaw';

/**
 * GET /api/setup/gateway/status
 * Returns whether the gateway is configured and reachable. Used by onboarding.
 */
export async function GET() {
    const gatewayUrl = getGatewayUrl();
    const configured = gatewayUrl !== null;
    const reachable = configured ? await isGatewayReachable() : false;
    return NextResponse.json({
        configured,
        reachable,
        ready: configured && reachable,
    });
}
