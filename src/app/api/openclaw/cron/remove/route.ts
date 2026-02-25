import { NextResponse } from 'next/server';
import { getGatewayUrl, getGatewayAuth, getGatewayControlUiOrigin } from '@/lib/openclaw';
import { withGatewayWs } from '@/lib/gateway-client';

export async function POST(request: Request) {
    const gatewayUrl = getGatewayUrl();
    if (!gatewayUrl) {
        return NextResponse.json(
            { error: 'Gateway not available. Start OpenClaw gateway to control tasks.' },
            { status: 503 }
        );
    }

    let body: { cronJobId: string };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { cronJobId } = body;
    if (!cronJobId?.trim()) {
        return NextResponse.json({ error: 'Missing cronJobId' }, { status: 400 });
    }

    const auth = getGatewayAuth();

    try {
        await withGatewayWs(gatewayUrl, { auth, origin: getGatewayControlUiOrigin() }, async (_ws, sendReq) => {
            await sendReq('cron.remove', { id: cronJobId.trim() });
        });
        return NextResponse.json({ success: true });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/not found|404|no such job/i.test(msg)) {
            return NextResponse.json({ success: true });
        }
        return NextResponse.json({ error: msg || 'Gateway error' }, { status: 503 });
    }
}
