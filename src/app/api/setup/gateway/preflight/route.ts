import { NextResponse } from 'next/server';
import { getGatewaySetupPreflight } from '@/lib/openclaw';

export async function GET() {
    const preflight = await getGatewaySetupPreflight();
    const res = NextResponse.json(preflight);
    res.headers.set('Cache-Control', 'no-store');
    return res;
}
