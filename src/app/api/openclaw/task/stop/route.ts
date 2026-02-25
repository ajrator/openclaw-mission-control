import { NextResponse } from 'next/server';
import {
    getGatewayUrl,
    getGatewayAuth,
    getGatewayControlUiOrigin,
    getTaskSessionKey,
    resolveAgentIdFromTaskAgent,
} from '@/lib/openclaw';
import { withGatewayWs } from '@/lib/gateway-client';
import { queryTasksFromNotion, isNotionConfigured } from '@/lib/notion';
import { getLocalTaskById } from '@/lib/local-tasks';

type TaskInput = { notionPageId?: string; localTaskId?: string; agent?: string };

function isTaskInputs(t: unknown): t is TaskInput[] {
    return Array.isArray(t) && t.every((x) => x && (typeof (x as TaskInput).notionPageId === 'string' || typeof (x as TaskInput).localTaskId === 'string'));
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

    type ResolvedTask = { taskId: string; agentId: string };
    let resolved: ResolvedTask[] = [];

    if (isTaskInputs(tasksParam) && tasksParam.length > 0) {
        for (const t of tasksParam) {
            const id = t.notionPageId ?? t.localTaskId;
            if (!id || !taskIdList.includes(id)) continue;
            const agentId = resolveAgentIdFromTaskAgent(t.agent);
            if (agentId) resolved.push({ taskId: id, agentId });
        }
    }
    if (resolved.length === 0) {
        for (const taskId of taskIdList) {
            const localTask = getLocalTaskById(taskId);
            if (localTask) {
                const agentId = resolveAgentIdFromTaskAgent(localTask.agent);
                if (agentId) resolved.push({ taskId, agentId });
                continue;
            }
            if (isNotionConfigured()) {
                const allTasks = await queryTasksFromNotion();
                const task = allTasks.find((t) => t.notionPageId === taskId);
                const agentId = resolveAgentIdFromTaskAgent(task?.agent);
                if (agentId) resolved.push({ taskId, agentId });
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
        const stopped: string[] = [];
        await withGatewayWs(
            gatewayUrl,
            { auth, origin },
            async (_ws, sendReq) => {
                try {
                    await sendReq('task.stop', {
                        agentId: resolved[0].agentId,
                        notionPageId: resolved[0].taskId,
                    });
                    resolved.forEach((r) => stopped.push(r.taskId));
                    for (let i = 1; i < resolved.length; i++) {
                        const { taskId, agentId } = resolved[i];
                        await sendReq('task.stop', { agentId, notionPageId: taskId });
                        stopped.push(taskId);
                    }
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    const unsupported =
                        /unknown method|method not found|not supported|501/i.test(msg) ||
                        msg.includes('task.stop');
                    if (!unsupported) throw err;
                    for (const { taskId, agentId } of resolved) {
                        const sessionKey = getTaskSessionKey(agentId, taskId);
                        await sendReq('chat.abort', { sessionKey });
                        stopped.push(taskId);
                    }
                }
                for (const { taskId, agentId } of resolved) {
                    const sessionKey = getTaskSessionKey(agentId, taskId);
                    try {
                        await sendReq('sessions.delete', { key: sessionKey, deleteTranscript: true });
                    } catch (delErr) {
                        const delMsg = delErr instanceof Error ? delErr.message : String(delErr);
                        if (!/session not found|not found|404/i.test(delMsg)) {
                            console.warn('[task/stop] sessions.delete failed:', delMsg);
                        }
                    }
                }
            }
        );
        return NextResponse.json({ stopped });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json(
            { error: msg || 'Gateway error' },
            { status: 503 }
        );
    }
}
