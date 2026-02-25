import { NextResponse } from 'next/server';
import { getGatewayUrl, getDefaultSessionKey, getGatewayAuth, getGatewayControlUiOrigin } from '@/lib/openclaw';
import { withGatewayWs } from '@/lib/gateway-client';
import type { EventFrame } from '@/lib/gateway-client';

function randomId(): string {
    return `mc-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export async function POST(request: Request) {
    const gatewayUrl = getGatewayUrl();
    if (!gatewayUrl) {
        return NextResponse.json(
            { error: 'Gateway not available. Start OpenClaw gateway to chat.' },
            { status: 503 }
        );
    }

    let body: { agentId?: string; message?: string; sessionKey?: string };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { agentId, message, sessionKey: sessionKeyParam } = body;
    if (!agentId || typeof message !== 'string' || !message.trim()) {
        return NextResponse.json({ error: 'Missing agentId or message' }, { status: 400 });
    }

    const sessionKey = sessionKeyParam ?? getDefaultSessionKey(agentId);
    const idempotencyKey = randomId();

    const stream = new ReadableStream({
        start(controller) {
            const encoder = new TextEncoder();
            const write = (data: string) => {
                controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            };

            let endResolve: () => void;
            const endPromise = new Promise<void>((r) => { endResolve = r; });

            const auth = getGatewayAuth();
            const origin = getGatewayControlUiOrigin();
            withGatewayWs(
                gatewayUrl,
                {
                    auth,
                    origin,
                    onEvent(evt: EventFrame) {
                        if (evt.event === 'chat') {
                            const p = evt.payload ?? {};
                            write(JSON.stringify(p));
                            const state = (p as { state?: string }).state;
                            if (state === 'final' || state === 'error' || state === 'aborted') {
                                endResolve();
                            }
                        }
                    },
                },
                async (_ws, sendReq) => {
                    await sendReq('chat.send', {
                        sessionKey,
                        message: message.trim(),
                        idempotencyKey,
                    });
                    await endPromise;
                }
            ).then(
                () => controller.close(),
                (err) => {
                    write(JSON.stringify({ state: 'error', errorMessage: err instanceof Error ? err.message : String(err) }));
                    controller.close();
                }
            );
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
        },
    });
}
