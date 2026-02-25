import { NextResponse } from 'next/server';
import { getGatewayUrl, getDefaultSessionKey, getGatewayAuth, getGatewayControlUiOrigin } from '@/lib/openclaw';
import { withGatewayWs } from '@/lib/gateway-client';

export async function GET(request: Request) {
    const gatewayUrl = getGatewayUrl();
    if (!gatewayUrl) {
        return NextResponse.json(
            { error: 'Gateway not available. Start OpenClaw gateway to chat.' },
            { status: 503 }
        );
    }

    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');
    const sessionKeyParam = searchParams.get('sessionKey');
    const limitParam = searchParams.get('limit');

    if (!agentId) {
        return NextResponse.json({ error: 'Missing agentId' }, { status: 400 });
    }

    const sessionKey = sessionKeyParam ?? getDefaultSessionKey(agentId);
    const limit = limitParam ? Math.min(500, Math.max(1, parseInt(limitParam, 10))) : 100;

    try {
        const auth = getGatewayAuth();
        const origin = getGatewayControlUiOrigin();
        const result = await withGatewayWs(gatewayUrl, { auth, origin }, async (_ws, sendReq) => {
            return await sendReq('chat.history', { sessionKey, limit });
        });

        const payload = result as { messages?: unknown[] } | undefined;
        const messages = Array.isArray(payload?.messages) ? payload.messages : [];
        return NextResponse.json({ messages });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Gateway request failed';
        if (message.includes('Gateway closed') || message.includes('not open') || message.includes('ECONNREFUSED')) {
            return NextResponse.json(
                { error: 'Gateway not available. Start OpenClaw gateway to chat.' },
                { status: 503 }
            );
        }
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
