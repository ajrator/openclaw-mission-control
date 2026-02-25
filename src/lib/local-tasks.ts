/**
 * Local task store: ~/.openclaw/local-tasks.json
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import type { TaskStatus } from '@/lib/notion';

const LOCAL_TASKS_FILE = 'local-tasks.json';

function getLocalTasksPath(): string {
    return path.join(os.homedir(), '.openclaw', LOCAL_TASKS_FILE);
}

export interface LocalTask {
    id: string;
    title: string;
    status: TaskStatus;
    agent: string;
    description: string;
    important?: boolean;
    urgent?: boolean;
    dueDate?: string | null;
    createdAt: string;
    updatedAt: string;
    /** Recurring task synced to OpenClaw cron */
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

function readLocalTasksFile(): LocalTask[] {
    const filePath = getLocalTasksPath();
    if (!fs.existsSync(filePath)) return [];
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw);
        if (!Array.isArray(data)) return [];
        return data.filter(
            (t: unknown): t is LocalTask =>
                t !== null &&
                typeof t === 'object' &&
                typeof (t as LocalTask).id === 'string' &&
                typeof (t as LocalTask).title === 'string' &&
                ['To Do', 'Doing', 'Done'].includes((t as LocalTask).status)
        );
    } catch {
        return [];
    }
}

function writeLocalTasksFile(tasks: LocalTask[]): void {
    const filePath = getLocalTasksPath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(tasks, null, 2) + '\n', 'utf-8');
}

export function getAllLocalTasks(): LocalTask[] {
    return readLocalTasksFile();
}

export function getLocalTaskById(id: string): LocalTask | null {
    return readLocalTasksFile().find((t) => t.id === id) ?? null;
}

function randomId(): string {
    return `local-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function createLocalTask(input: {
    title: string;
    status: TaskStatus;
    agent: string;
    description: string;
    important?: boolean;
    urgent?: boolean;
    dueDate?: string | null;
    recurring?: boolean;
    cron?: string | null;
    cronJobId?: string | null;
    recurUnit?: string | null;
    recurInterval?: number | null;
    recurTime?: string | null;
    recurEnd?: string | null;
    recurEndCount?: number | null;
    recurEndDate?: string | null;
}): LocalTask {
    const tasks = readLocalTasksFile();
    const now = new Date().toISOString();
    const task: LocalTask = {
        id: randomId(),
        title: input.title.trim(),
        status: input.status,
        agent: input.agent.trim(),
        description: input.description.trim(),
        important: input.important,
        urgent: input.urgent,
        dueDate: input.dueDate ?? null,
        createdAt: now,
        updatedAt: now,
        recurring: input.recurring,
        cron: input.cron ?? null,
        cronJobId: input.cronJobId ?? null,
        recurUnit: input.recurUnit ?? null,
        recurInterval: input.recurInterval ?? null,
        recurTime: input.recurTime ?? null,
        recurEnd: input.recurEnd ?? null,
        recurEndCount: input.recurEndCount ?? null,
        recurEndDate: input.recurEndDate ?? null,
    };
    tasks.push(task);
    writeLocalTasksFile(tasks);
    return task;
}

export function updateLocalTask(
    id: string,
    updates: Partial<Pick<LocalTask, 'title' | 'status' | 'agent' | 'description' | 'important' | 'urgent' | 'dueDate' | 'recurring' | 'cron' | 'cronJobId' | 'recurUnit' | 'recurInterval' | 'recurTime' | 'recurEnd' | 'recurEndCount' | 'recurEndDate'>>
): LocalTask | null {
    const tasks = readLocalTasksFile();
    const idx = tasks.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    const now = new Date().toISOString();
    tasks[idx] = {
        ...tasks[idx],
        ...updates,
        updatedAt: now,
    };
    if (updates.dueDate !== undefined) tasks[idx].dueDate = updates.dueDate ?? null;
    if (updates.cron !== undefined) tasks[idx].cron = updates.cron ?? null;
    if (updates.cronJobId !== undefined) tasks[idx].cronJobId = updates.cronJobId ?? null;
    writeLocalTasksFile(tasks);
    return tasks[idx];
}

export function deleteLocalTask(id: string): boolean {
    const tasks = readLocalTasksFile();
    const next = tasks.filter((t) => t.id !== id);
    if (next.length === tasks.length) return false;
    writeLocalTasksFile(next);
    return true;
}
