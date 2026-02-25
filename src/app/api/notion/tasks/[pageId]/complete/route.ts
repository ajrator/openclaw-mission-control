import { NextResponse } from 'next/server';
import {
    updateTaskProperties,
    isNotionConfigured,
    invalidateTasksCache,
    getTaskDetails,
} from '@/lib/notion';
import {
    getTaskSessionKey,
    resolveAgentIdFromTaskAgent,
    getGatewayUrl,
    getGatewayAuth,
    getGatewayControlUiOrigin,
} from '@/lib/openclaw';
import { withGatewayWs } from '@/lib/gateway-client';

/**
 * POST /api/notion/tasks/[pageId]/complete
 * Sets the task status to "Done" in Notion. Call this when the agent has finished
 * working on the task (e.g. from the gateway when the task run completes).
 * Mission Control UI will show the task in Done after refresh or tab focus.
 * Also deletes the task's chat session from the gateway (best-effort).
 */
export async function POST(
    _request: Request,
    { params }: { params: Promise<{ pageId: string }> }
) {
    if (!isNotionConfigured()) {
        return NextResponse.json({ error: 'Notion is not configured' }, { status: 503 });
    }
    try {
        const { pageId } = await params;
        if (!pageId) {
            return NextResponse.json({ error: 'Missing pageId' }, { status: 400 });
        }
        await updateTaskProperties(pageId, { status: 'Done' });
        invalidateTasksCache();

        const gatewayUrl = getGatewayUrl();
        if (gatewayUrl) {
            try {
                const details = await getTaskDetails(pageId);
                const agentId = resolveAgentIdFromTaskAgent(details?.agent);
                if (agentId) {
                    const taskSessionKey = getTaskSessionKey(agentId, pageId);
                    const auth = getGatewayAuth();
                    const origin = getGatewayControlUiOrigin();
                    await withGatewayWs(gatewayUrl, { auth, origin }, async (_ws, sendReq) => {
                        await sendReq('sessions.delete', {
                            key: taskSessionKey,
                            deleteTranscript: true,
                        });
                    });
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (!/session not found|not found|404/i.test(msg)) {
                    console.warn('[complete] sessions.delete failed:', msg);
                }
            }
        }

        return NextResponse.json({ success: true, status: 'Done' });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
