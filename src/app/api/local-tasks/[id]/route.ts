import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getLocalTaskById, updateLocalTask, deleteLocalTask } from '@/lib/local-tasks';
import type { TaskStatus } from '@/lib/notion';

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteParams) {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'Missing task id' }, { status: 400 });
    try {
        const body = await request.json().catch(() => ({}));
        const updates: Parameters<typeof updateLocalTask>[1] = {};
        if (body.title !== undefined) updates.title = typeof body.title === 'string' ? body.title : undefined;
        if (body.status !== undefined) updates.status = ['To Do', 'Doing', 'Done'].includes(body.status) ? (body.status as TaskStatus) : undefined;
        if (body.agent !== undefined) updates.agent = typeof body.agent === 'string' ? body.agent : undefined;
        if (body.description !== undefined) updates.description = typeof body.description === 'string' ? body.description : undefined;
        if (body.important !== undefined) updates.important = typeof body.important === 'boolean' ? body.important : undefined;
        if (body.urgent !== undefined) updates.urgent = typeof body.urgent === 'boolean' ? body.urgent : undefined;
        if (body.dueDate !== undefined) updates.dueDate = body.dueDate === null || typeof body.dueDate === 'string' ? body.dueDate : undefined;
        if (body.recurring !== undefined) updates.recurring = typeof body.recurring === 'boolean' ? body.recurring : undefined;
        if (body.cron !== undefined) updates.cron = body.cron === null || typeof body.cron === 'string' ? body.cron : undefined;
        if (body.cronJobId !== undefined) updates.cronJobId = body.cronJobId === null || typeof body.cronJobId === 'string' ? body.cronJobId : undefined;
        if (body.recurUnit !== undefined) updates.recurUnit = body.recurUnit === null || typeof body.recurUnit === 'string' ? body.recurUnit : undefined;
        if (body.recurInterval !== undefined) updates.recurInterval = typeof body.recurInterval === 'number' ? body.recurInterval : undefined;
        if (body.recurTime !== undefined) updates.recurTime = body.recurTime === null || typeof body.recurTime === 'string' ? body.recurTime : undefined;
        if (body.recurEnd !== undefined) updates.recurEnd = body.recurEnd === null || typeof body.recurEnd === 'string' ? body.recurEnd : undefined;
        if (body.recurEndCount !== undefined) updates.recurEndCount = typeof body.recurEndCount === 'number' ? body.recurEndCount : undefined;
        if (body.recurEndDate !== undefined) updates.recurEndDate = body.recurEndDate === null || typeof body.recurEndDate === 'string' ? body.recurEndDate : undefined;
        const task = updateLocalTask(id, updates);
        if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
        revalidateTag('tasks', 'max');
        return NextResponse.json(task);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function DELETE(request: Request, { params }: RouteParams) {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'Missing task id' }, { status: 400 });
    const ok = deleteLocalTask(id);
    if (!ok) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    revalidateTag('tasks', 'max');
    return NextResponse.json({ deleted: true });
}
