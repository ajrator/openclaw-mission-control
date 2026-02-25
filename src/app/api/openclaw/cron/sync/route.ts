import { NextResponse } from 'next/server';
import { getGatewayUrl, getGatewayAuth, getGatewayControlUiOrigin, resolveAgentIdFromTaskAgent } from '@/lib/openclaw';
import { withGatewayWs } from '@/lib/gateway-client';
import { getTaskDetails, isNotionConfigured } from '@/lib/notion';
import { getLocalTaskById } from '@/lib/local-tasks';

const NOTION_COMPLETE_INSTRUCTION = (origin: string, notionPageId: string) =>
    `\n\nWhen you have completed this task, you MUST call Mission Control to mark it Done: send POST ${origin}/api/notion/tasks/${notionPageId}/complete (no body).`;

const LOCAL_COMPLETE_INSTRUCTION = (origin: string, localTaskId: string) =>
    `\n\nWhen you have completed this task, you MUST call Mission Control to mark it Done: send POST ${origin}/api/local-tasks/${localTaskId}/complete (no body).`;

function buildMessage(
    source: 'notion' | 'local',
    taskId: string,
    title: string,
    description: string | undefined,
    origin: string
): string {
    const body =
        (description ?? '').trim().length > 0
            ? `Title: ${(title || 'Untitled').trim()}\n\nDescription:\n${description}`
            : `Title: ${(title || 'Untitled').trim()}`;
    const instruction = source === 'notion' ? NOTION_COMPLETE_INSTRUCTION(origin, taskId) : LOCAL_COMPLETE_INSTRUCTION(origin, taskId);
    return `This is a recurring task. Work on it now.\n\n${body}${instruction}`;
}

export async function POST(request: Request) {
    const gatewayUrl = getGatewayUrl();
    if (!gatewayUrl) {
        return NextResponse.json(
            { error: 'Gateway not available. Start OpenClaw gateway to control tasks.' },
            { status: 503 }
        );
    }

    let body: {
        taskId: string;
        source: 'notion' | 'local';
        agentId?: string;
        agent?: string;
        name: string;
        description?: string;
        schedule: { kind: 'cron'; expr: string; tz?: string };
        cronJobId?: string;
        enabled?: boolean;
    };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { taskId, source, name, description, schedule, cronJobId, enabled = true } = body;
    const agentId = body.agentId ?? (body.agent ? resolveAgentIdFromTaskAgent(body.agent) : null);
    if (!taskId || !schedule?.expr?.trim()) {
        return NextResponse.json({ error: 'Missing taskId or schedule.expr' }, { status: 400 });
    }
    if (!agentId) {
        return NextResponse.json({ error: 'Missing or invalid agent (agentId or agent name required)' }, { status: 400 });
    }

    let title = name;
    let desc = description;
    if (source === 'notion' && isNotionConfigured()) {
        try {
            const details = await getTaskDetails(taskId);
            title = details?.title ?? title;
            desc = details?.description ?? desc;
        } catch {
            // use name/description from body
        }
    } else if (source === 'local') {
        const local = getLocalTaskById(taskId);
        if (local) {
            title = local.title;
            desc = local.description ?? desc;
        }
    }

    const origin = getGatewayControlUiOrigin();
    const message = buildMessage(source, taskId, title, desc, origin);

    const auth = getGatewayAuth();

    try {
        const jobId = await withGatewayWs(
            gatewayUrl,
            { auth, origin: getGatewayControlUiOrigin() },
            async (_ws, sendReq) => {
                const payload = { kind: 'agentTurn' as const, message };
                const schedulePayload = { kind: 'cron' as const, expr: schedule.expr.trim(), ...(schedule.tz && { tz: schedule.tz }) };

                if (cronJobId) {
                    await sendReq('cron.update', {
                        id: cronJobId,
                        name: title || name,
                        description: desc ?? undefined,
                        schedule: schedulePayload,
                        payload,
                        agentId,
                        enabled,
                    });
                    return cronJobId;
                }
                const result = (await sendReq('cron.add', {
                    name: title || name,
                    description: desc ?? undefined,
                    agentId,
                    schedule: schedulePayload,
                    sessionTarget: 'isolated',
                    wakeMode: 'next-heartbeat',
                    payload,
                    enabled,
                })) as { id?: string };
                return result?.id ?? '';
            }
        );

        return NextResponse.json({ cronJobId: jobId ?? '' });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg || 'Gateway error' }, { status: 503 });
    }
}
