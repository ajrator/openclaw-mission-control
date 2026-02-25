import { NextResponse } from 'next/server';
import {
    getGatewayUrl,
    getGatewayAuth,
    getGatewayControlUiOrigin,
    getTaskSessionKey,
    resolveAgentIdFromTaskAgent,
} from '@/lib/openclaw';

const NOTION_UPDATE_CONTENT_INSTRUCTION = (origin: string, notionPageId: string) =>
    `\n\nTo update the task page content (so it appears in Mission Control), call Mission Control: POST ${origin}/api/notion/tasks/${notionPageId}/content with JSON body { "content": "your full response or progress" } to replace the page body, or { "append": "additional text" } to append. Use your HTTP or fetch tool.`;

const NOTION_COMPLETE_INSTRUCTION = (origin: string, notionPageId: string) =>
    `\n\nWhen you have completed this task, you MUST call Mission Control to mark it Done and clean up this session: send POST ${origin}/api/notion/tasks/${notionPageId}/complete (no body). If you have an HTTP or fetch tool, use it; otherwise the user must mark the task Done in the UI.`;

const LOCAL_COMPLETE_INSTRUCTION = (origin: string, localTaskId: string) =>
    `\n\nWhen you have completed this task, you MUST call Mission Control to mark it Done and clean up this session: send POST ${origin}/api/local-tasks/${localTaskId}/complete (no body). If you have an HTTP or fetch tool, use it; otherwise the user must mark the task Done in the UI.`;

import { withGatewayWs } from '@/lib/gateway-client';
import { queryTasksFromNotion, isNotionConfigured, getTaskDetails } from '@/lib/notion';
import { getLocalTaskById } from '@/lib/local-tasks';

type TaskInput = { notionPageId?: string; localTaskId?: string; agent?: string };

function isTaskInputs(t: unknown): t is TaskInput[] {
    return Array.isArray(t) && t.every((x) => x && (typeof (x as TaskInput).notionPageId === 'string' || typeof (x as TaskInput).localTaskId === 'string'));
}

function randomId(): string {
    return `mc-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export async function POST(request: Request) {
    const gatewayUrl = getGatewayUrl();
    if (!gatewayUrl) {
        return NextResponse.json(
            { error: 'Gateway not available. Start OpenClaw gateway to control tasks.' },
            { status: 503 }
        );
    }

    let body: { taskIds?: string[]; tasks?: unknown };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { taskIds, tasks: tasksParam } = body;
    const taskIdList = Array.isArray(taskIds) ? taskIds.filter((id) => typeof id === 'string') : [];
    if (taskIdList.length === 0) {
        return NextResponse.json({ error: 'Missing or empty taskIds' }, { status: 400 });
    }

    type ResolvedTask = { taskId: string; agentId: string; source: 'notion' | 'local' };
    let resolved: ResolvedTask[] = [];

    if (isTaskInputs(tasksParam) && tasksParam.length > 0) {
        for (const t of tasksParam) {
            const id = t.notionPageId ?? t.localTaskId;
            if (!id || !taskIdList.includes(id)) continue;
            const agentId = resolveAgentIdFromTaskAgent(t.agent);
            if (agentId)
                resolved.push({
                    taskId: id,
                    agentId,
                    source: t.localTaskId != null ? 'local' : 'notion',
                });
        }
    }
    if (resolved.length === 0) {
        for (const taskId of taskIdList) {
            const localTask = getLocalTaskById(taskId);
            if (localTask) {
                const agentId = resolveAgentIdFromTaskAgent(localTask.agent);
                if (agentId) resolved.push({ taskId, agentId, source: 'local' });
                continue;
            }
            if (isNotionConfigured()) {
                const allTasks = await queryTasksFromNotion();
                const task = allTasks.find((t) => t.notionPageId === taskId);
                const agentId = resolveAgentIdFromTaskAgent(task?.agent);
                if (agentId) resolved.push({ taskId, agentId, source: 'notion' });
            }
        }
    }

    if (resolved.length === 0) {
        return NextResponse.json(
            { error: 'No tasks with an assigned agent could be resolved.' },
            { status: 400 }
        );
    }

    const auth = getGatewayAuth();
    const origin = getGatewayControlUiOrigin();

    try {
        const started: string[] = [];
        await withGatewayWs(
            gatewayUrl,
            { auth, origin },
            async (_ws, sendReq) => {
                const notionResolved = resolved.filter((r) => r.source === 'notion');
                const localResolved = resolved.filter((r) => r.source === 'local');
                if (notionResolved.length > 0) {
                    try {
                        await sendReq('task.start', {
                            agentId: notionResolved[0].agentId,
                            notionPageId: notionResolved[0].taskId,
                        });
                        notionResolved.forEach((r) => started.push(r.taskId));
                        for (let i = 1; i < notionResolved.length; i++) {
                            const { taskId, agentId } = notionResolved[i];
                            await sendReq('task.start', { agentId, notionPageId: taskId });
                            started.push(taskId);
                        }
                    } catch (err) {
                        const msg = err instanceof Error ? err.message : String(err);
                        const unsupported =
                            /unknown method|method not found|not supported|501/i.test(msg) ||
                            msg.includes('task.start');
                        if (!unsupported) throw err;
                        for (const { taskId, agentId } of notionResolved) {
                            const sessionKey = getTaskSessionKey(agentId, taskId);
                            let message: string;
                            try {
                                const details = await getTaskDetails(taskId);
                                const desc = (details.description ?? '').trim();
                                message = desc
                                    ? `Work on this Notion task.\n\nTitle: ${(details.title ?? '').trim() || 'Untitled'}\n\nDescription:\n${desc}\n\nNotion page ID: ${taskId}.`
                                    : `Work on the Notion task with page ID: ${taskId}.`;
                            } catch {
                                message = `Work on the Notion task with page ID: ${taskId}.`;
                            }
                            message = message + NOTION_UPDATE_CONTENT_INSTRUCTION(origin, taskId) + NOTION_COMPLETE_INSTRUCTION(origin, taskId);
                            await sendReq('chat.send', {
                                sessionKey,
                                message,
                                idempotencyKey: randomId(),
                            });
                            started.push(taskId);
                        }
                    }
                }
                for (const { taskId, agentId } of localResolved) {
                    const localTask = getLocalTaskById(taskId);
                    const sessionKey = getTaskSessionKey(agentId, taskId);
                    const title = localTask?.title?.trim() || 'Untitled';
                    const desc = (localTask?.description ?? '').trim();
                    const body = desc
                        ? `Work on this task.\n\nTitle: ${title}\n\nDescription:\n${desc}`
                        : `Work on the task: ${title}`;
                    const fullMessage = body + LOCAL_COMPLETE_INSTRUCTION(origin, taskId);
                    await sendReq('chat.send', {
                        sessionKey,
                        message: fullMessage,
                        idempotencyKey: randomId(),
                    });
                    started.push(taskId);
                }
            }
        );
        return NextResponse.json({ started });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json(
            { error: msg || 'Gateway error' },
            { status: 503 }
        );
    }
}
