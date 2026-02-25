/**
 * Minimal gateway WebSocket client for Mission Control chat API.
 * Protocol: send req (type, id, method, params), receive res (type, id, ok, payload) or event (type, event, payload).
 */
import WebSocket from 'ws';

const PROTOCOL_VERSION = 3;

type ReqFrame = { type: 'req'; id: string; method: string; params?: unknown };
type ResFrame = { type: 'res'; id: string; ok: boolean; payload?: unknown; error?: { message?: string; errorMessage?: string } | string };
export type EventFrame = { type: 'event'; event: string; payload?: unknown; seq?: number };

function isEventFrame(f: unknown): f is EventFrame {
    return typeof f === 'object' && f !== null && (f as EventFrame).type === 'event' && typeof (f as EventFrame).event === 'string';
}
function isResFrame(f: unknown): f is ResFrame {
    return typeof f === 'object' && f !== null && (f as ResFrame).type === 'res' && typeof (f as ResFrame).id === 'string';
}

function randomId(): string {
    return `mc-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** Client id the gateway accepts for connect (must match gateway schema). */
const CONTROL_UI_CLIENT_ID = 'openclaw-control-ui';

export type GatewayWsOptions = {
    onEvent?: (evt: EventFrame) => void;
    /** Gateway auth (token or password) for connect. Enables chat when gateway requires auth. */
    auth?: { token?: string; password?: string };
    /** Origin to send on the WebSocket handshake. Required when using Control UI client id; must be allowed in gateway.controlUi.allowedOrigins. */
    origin?: string;
};

export async function withGatewayWs<T>(
    url: string,
    options: GatewayWsOptions | ((ws: WebSocket, sendReq: (method: string, params?: unknown) => Promise<unknown>) => Promise<T>),
    fn?: (ws: WebSocket, sendReq: (method: string, params?: unknown) => Promise<unknown>) => Promise<T>
): Promise<T> {
    const opts: GatewayWsOptions = typeof options === 'function' ? {} : options;
    const callback = typeof options === 'function' ? options : fn!;

    const origin = opts.origin ?? 'http://localhost:3000';
    const ws = new WebSocket(url, {
        headers: { origin },
    });
    const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

    const sendReq = (method: string, params?: unknown): Promise<unknown> => {
        return new Promise((resolve, reject) => {
            if (ws.readyState !== WebSocket.OPEN) {
                reject(new Error('WebSocket not open'));
                return;
            }
            const id = randomId();
            const frame: ReqFrame = { type: 'req', id, method, params };
            pending.set(id, { resolve, reject });
            ws.send(JSON.stringify(frame));
        });
    };

    ws.on('message', (data: Buffer) => {
        try {
            const parsed = JSON.parse(data.toString()) as unknown;
            if (isEventFrame(parsed)) {
                opts.onEvent?.(parsed);
                return;
            }
            if (isResFrame(parsed)) {
                const p = pending.get(parsed.id);
                if (p) {
                    pending.delete(parsed.id);
                    if (parsed.ok) p.resolve(parsed.payload);
                    else {
                        const err = parsed.error;
                        const msg = typeof err === 'string' ? err : err?.message ?? (err as { errorMessage?: string })?.errorMessage ?? 'Gateway error';
                        p.reject(new Error(msg));
                    }
                }
            }
        } catch {
            // ignore parse errors
        }
    });

    await new Promise<void>((resolve, reject) => {
        ws.on('open', () => resolve());
        ws.on('error', (err) => reject(err));
        ws.on('close', () => {
            const err = new Error('Gateway closed');
            for (const p of pending.values()) p.reject(err);
            pending.clear();
        });
    });

    try {
        const connectPayload = {
            minProtocol: PROTOCOL_VERSION,
            maxProtocol: PROTOCOL_VERSION,
            client: {
                id: CONTROL_UI_CLIENT_ID,
                version: '1.0',
                platform: 'node',
                mode: 'backend' as const,
            },
            role: 'operator' as const,
            scopes: ['operator.read', 'operator.write', 'operator.admin'],
            ...(opts.auth && (opts.auth.token || opts.auth.password)
                ? { auth: { token: opts.auth.token, password: opts.auth.password } }
                : {}),
        };
        const hello = await sendReq('connect', connectPayload);
        if (!hello || typeof (hello as { protocol?: number }).protocol !== 'number') {
            throw new Error('Invalid gateway hello');
        }
        return await callback(ws, sendReq);
    } finally {
        ws.close();
    }
}

export type ChatEventPayload = { state?: string; message?: unknown; errorMessage?: string; usage?: unknown; stopReason?: string };
