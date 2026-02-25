import { NextResponse } from 'next/server';
import { getGatewayUrl, getDefaultSessionKey, getGatewayAuth, getGatewayControlUiOrigin } from '@/lib/openclaw';
import { withGatewayWs } from '@/lib/gateway-client';

/** Delete chat history for an agent's default session (clears transcript on the gateway). */
export async function POST(request: Request) {
    const gatewayUrl = getGatewayUrl();
    if (!gatewayUrl) {
        return NextResponse.json(
            { error: 'Gateway not available. Start OpenClaw gateway to chat.' },
            { status: 503 }
        );
    }

    let body: { agentId?: string; sessionKey?: string };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { agentId, sessionKey: sessionKeyParam } = body;
    const sessionKey = sessionKeyParam ?? (agentId ? getDefaultSessionKey(agentId) : null);
    if (!sessionKey) {
        return NextResponse.json({ error: 'Missing agentId or sessionKey' }, { status: 400 });
    }

    try {
        const auth = getGatewayAuth();
        const origin = getGatewayControlUiOrigin();
        await withGatewayWs(gatewayUrl, { auth, origin }, async (_ws, sendReq) => {
            let deleted = false;
            try {
                await sendReq('sessions.delete', { key: sessionKey, deleteTranscript: true });
                deleted = true;
            } catch (deleteErr) {
                try {
                    await sendReq('sessions.reset', { key: sessionKey, reason: 'reset' });
                } catch (_resetErr) {
                    const msg = deleteErr instanceof Error ? deleteErr.message : String(deleteErr);
                    throw new Error(msg);
                }
            }
        });
        return NextResponse.json({ success: true });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('Gateway closed') || message.includes('not open') || message.includes('ECONNREFUSED')) {
            return NextResponse.json(
                { error: 'Gateway not available. Start OpenClaw gateway to chat.' },
                { status: 503 }
            );
        }
        if (/session not found|not found|404/i.test(message)) {
            return NextResponse.json({ success: true });
        }
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
