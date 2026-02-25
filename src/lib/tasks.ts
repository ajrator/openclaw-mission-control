/**
 * Unified task type and helpers for the Tasks UI.
 * Tasks can come from Notion or the local store.
 */

import type { TaskStatus } from '@/lib/notion';
import type { LocalTask } from '@/lib/local-tasks';
import type { NotionTask } from '@/lib/notion';

export type TaskSource = 'notion' | 'local';

export interface Task {
    id: string;
    source: TaskSource;
    title: string;
    status: TaskStatus;
    agent?: string;
    important?: boolean;
    urgent?: boolean;
    dueDate?: string;
    /** Only present when source === 'notion' */
    notionPageId?: string;
    /** Only present when source === 'local'; for modal/display */
    description?: string;
    /** Recurring task (synced to OpenClaw cron) */
    recurring?: boolean;
    cron?: string | null;
    cronJobId?: string | null;
    recurUnit?: string | null;
    recurInterval?: number | null;
    recurTime?: string | null;
    recurEnd?: string | null;
    recurEndCount?: number | null;
    recurEndDate?: string | null;
}

export function localToTask(t: LocalTask): Task {
    return {
        id: t.id,
        source: 'local',
        title: t.title,
        status: t.status,
        agent: t.agent,
        important: t.important,
        urgent: t.urgent,
        dueDate: t.dueDate ?? undefined,
        description: t.description,
        recurring: t.recurring,
        cron: t.cron ?? undefined,
        cronJobId: t.cronJobId ?? undefined,
        recurUnit: t.recurUnit ?? undefined,
        recurInterval: t.recurInterval ?? undefined,
        recurTime: t.recurTime ?? undefined,
        recurEnd: t.recurEnd ?? undefined,
        recurEndCount: t.recurEndCount ?? undefined,
        recurEndDate: t.recurEndDate ?? undefined,
    };
}

export function notionToTask(t: NotionTask): Task {
    return {
        id: t.notionPageId,
        source: 'notion',
        notionPageId: t.notionPageId,
        title: t.title,
        status: t.status,
        agent: t.agent,
        important: t.important,
        urgent: t.urgent,
        dueDate: t.dueDate,
        recurring: t.recurring,
        cron: t.cron,
        cronJobId: t.cronJobId,
        recurUnit: t.recurUnit ?? undefined,
        recurInterval: t.recurInterval ?? undefined,
        recurTime: t.recurTime ?? undefined,
        recurEnd: t.recurEnd ?? undefined,
        recurEndCount: t.recurEndCount ?? undefined,
        recurEndDate: t.recurEndDate ?? undefined,
    };
}

const COLUMN_ORDER: TaskStatus[] = ['To Do', 'Doing', 'Done'];

export function sortTasks(tasks: Task[]): Task[] {
    return [...tasks].sort((a, b) => {
        const ai = COLUMN_ORDER.indexOf(a.status);
        const bi = COLUMN_ORDER.indexOf(b.status);
        if (ai !== bi) return ai - bi;
        return (a.title || '').localeCompare(b.title || '');
    });
}
