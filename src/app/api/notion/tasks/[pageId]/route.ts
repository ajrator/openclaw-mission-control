import { NextResponse } from 'next/server';
import {
    updateTaskProperties,
    archiveTask,
    isNotionConfigured,
    getTaskDetails,
} from '@/lib/notion';
import type { TaskStatus } from '@/lib/notion';
import {
    getTaskSessionKey,
    resolveAgentIdFromTaskAgent,
    getGatewayUrl,
    getGatewayAuth,
    getGatewayControlUiOrigin,
} from '@/lib/openclaw';
import { withGatewayWs } from '@/lib/gateway-client';

function notConfigured() {
    return NextResponse.json({ error: 'Notion is not configured' }, { status: 503 });
}

export async function PATCH(
    _request: Request,
    { params }: { params: Promise<{ pageId: string }> }
) {
    if (!isNotionConfigured()) return notConfigured();
    try {
        const { pageId } = await params;
        const body = await _request.json().catch(() => ({}));
        const status = body.status as TaskStatus | undefined;
        const agent = typeof body.agent === 'string' ? body.agent : undefined;
        const important = body.important as boolean | undefined;
        const urgent = body.urgent as boolean | undefined;
        const dueDate = body.dueDate !== undefined ? (body.dueDate as string | null) : undefined;
        const description = typeof body.description === 'string' ? body.description : undefined;
        const recurring = body.recurring as boolean | undefined;
        const cron = body.cron !== undefined ? (body.cron as string | null) : undefined;
        const cronJobId = body.cronJobId !== undefined ? (body.cronJobId as string | null) : undefined;
        const recurUnit = body.recurUnit !== undefined ? (body.recurUnit as string | null) : undefined;
        const recurInterval = body.recurInterval !== undefined ? (typeof body.recurInterval === 'number' ? body.recurInterval : null) : undefined;
        const recurTime = body.recurTime !== undefined ? (body.recurTime as string | null) : undefined;
        const recurEnd = body.recurEnd !== undefined ? (body.recurEnd as string | null) : undefined;
        const recurEndCount = body.recurEndCount !== undefined ? (typeof body.recurEndCount === 'number' ? body.recurEndCount : null) : undefined;
        const recurEndDate = body.recurEndDate !== undefined ? (body.recurEndDate as string | null) : undefined;

        if (!pageId) {
            return NextResponse.json({ error: 'Missing pageId' }, { status: 400 });
        }
        const hasStatus = status !== undefined && ['To Do', 'Doing', 'Done'].includes(status);
        const hasImportant = important === true || important === false;
        const hasUrgent = urgent === true || urgent === false;
        const hasAny =
            hasStatus ||
            hasImportant ||
            hasUrgent ||
            agent !== undefined ||
            dueDate !== undefined ||
            description !== undefined ||
            recurring !== undefined ||
            cron !== undefined ||
            cronJobId !== undefined ||
            recurUnit !== undefined ||
            recurInterval !== undefined ||
            recurTime !== undefined ||
            recurEnd !== undefined ||
            recurEndCount !== undefined ||
            recurEndDate !== undefined;
        if (!hasAny) {
            return NextResponse.json(
                { error: 'Provide at least one of: status, agent, important, urgent, dueDate, description, recurring, cron, cronJobId, recurUnit, recurInterval, recurTime, recurEnd, recurEndCount, recurEndDate' },
                { status: 400 }
            );
        }

        await updateTaskProperties(pageId, {
            ...(hasStatus && { status }),
            ...(agent !== undefined && { agent }),
            ...(hasImportant && { important }),
            ...(hasUrgent && { urgent }),
            ...(dueDate !== undefined && { dueDate }),
            ...(description !== undefined && { description }),
            ...(recurring !== undefined && { recurring }),
            ...(cron !== undefined && { cron }),
            ...(cronJobId !== undefined && { cronJobId }),
            ...(recurUnit !== undefined && { recurUnit }),
            ...(recurInterval !== undefined && { recurInterval }),
            ...(recurTime !== undefined && { recurTime }),
            ...(recurEnd !== undefined && { recurEnd }),
            ...(recurEndCount !== undefined && { recurEndCount }),
            ...(recurEndDate !== undefined && { recurEndDate }),
        });

        if (hasStatus && status === 'Doing') {
            const gatewayUrl = getGatewayUrl();
            if (gatewayUrl) {
                try {
                    const taskAgent =
                        agent ?? (await getTaskDetails(pageId).then((d) => d?.agent));
                    const agentId = resolveAgentIdFromTaskAgent(taskAgent);
                    if (agentId) {
                        const auth = getGatewayAuth();
                        const origin = getGatewayControlUiOrigin();
                        await withGatewayWs(gatewayUrl, { auth, origin }, async (_ws, sendReq) => {
                            try {
                                await sendReq('task.start', { agentId, notionPageId: pageId });
                            } catch (err) {
                                const msg = err instanceof Error ? err.message : String(err);
                                const unsupported =
                                    /unknown method|method not found|not supported|501/i.test(msg) ||
                                    msg.includes('task.start');
                                if (!unsupported) throw err;
                                const sessionKey = getTaskSessionKey(agentId, pageId);
                                let message: string;
                                try {
                                    const details = await getTaskDetails(pageId);
                                    const desc = (details.description ?? '').trim();
                                    message = desc
                                        ? `Work on this Notion task.\n\nTitle: ${(details.title ?? '').trim() || 'Untitled'}\n\nDescription:\n${desc}\n\nNotion page ID: ${pageId}.`
                                        : `Work on the Notion task with page ID: ${pageId}.`;
                                } catch {
                                    message = `Work on the Notion task with page ID: ${pageId}.`;
                                }
                                const mcOrigin = getGatewayControlUiOrigin();
                                message =
                                    message +
                                    `\n\nTo update the task page content (so it appears in Mission Control), call Mission Control: POST ${mcOrigin}/api/notion/tasks/${pageId}/content with JSON body { "content": "your full response or progress" } to replace the page body, or { "append": "additional text" } to append. Use your HTTP or fetch tool.` +
                                    `\n\nWhen you have completed this task, you MUST call Mission Control to mark it Done and clean up this session: send POST ${mcOrigin}/api/notion/tasks/${pageId}/complete (no body). If you have an HTTP or fetch tool, use it; otherwise the user must mark the task Done in the UI.`;
                                await sendReq('chat.send', {
                                    sessionKey,
                                    message,
                                    idempotencyKey: `mc-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
                                });
                            }
                        });
                    }
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    console.warn('[PATCH task] kickoff on Doing failed:', msg);
                }
            }
        }

        if (hasStatus && status === 'Done') {
            const gatewayUrl = getGatewayUrl();
            if (gatewayUrl) {
                try {
                    const taskAgent =
                        agent ?? (await getTaskDetails(pageId).then((d) => d?.agent));
                    const agentId = resolveAgentIdFromTaskAgent(taskAgent);
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
                        console.warn('[PATCH task] sessions.delete failed:', msg);
                    }
                }
            }
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ pageId: string }> }
) {
    if (!isNotionConfigured()) return notConfigured();
    try {
        const { pageId } = await params;
        if (!pageId) {
            return NextResponse.json({ error: 'Missing pageId' }, { status: 400 });
        }
        await archiveTask(pageId);
        return NextResponse.json({ success: true });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
