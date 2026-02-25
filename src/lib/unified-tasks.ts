/**
 * Server-side unified task list: Notion + local based on preference.
 * When Notion is enabled, tasks are read from both Notion and local storage; creates/updates/deletes
 * go to the correct backend per task source (task.source), so the app stays 2-way synced with Notion.
 */

import { getAllLocalTasks } from '@/lib/local-tasks';
import { isNotionTasksEnabled } from '@/lib/mission-control-prefs';
import { queryTasksFromNotion, getDatabaseSchema, isNotionConfigured } from '@/lib/notion';
import { getOpenClawData } from '@/lib/openclaw';
import { localToTask, notionToTask, sortTasks, type Task } from '@/lib/tasks';

export interface UnifiedTasksResult {
    tasks: Task[];
    agentOptions: string[];
    notionEnabled: boolean;
    notionConfigured: boolean;
}

export async function getUnifiedTasks(forceRefresh?: boolean, recurringOnly?: boolean): Promise<UnifiedTasksResult> {
    const notionEnabled = isNotionTasksEnabled();
    const notionConfigured = isNotionConfigured();
    const localTasks = getAllLocalTasks();
    const tasksLocal = localTasks.map(localToTask);
    let tasksNotion: Task[] = [];
    let agentOptions: string[] = [];

    if (notionEnabled && notionConfigured) {
        const [notionList, schema] = await Promise.all([
            queryTasksFromNotion({ forceRefresh }),
            getDatabaseSchema({ forceRefresh }),
        ]);
        tasksNotion = notionList.map(notionToTask);
        agentOptions = schema?.agentOptions ?? [];
    }

    if (agentOptions.length === 0) {
        const data = getOpenClawData();
        agentOptions = data.agents.map((a) => a.name || a.id);
    }

    let tasks = sortTasks([...tasksNotion, ...tasksLocal]);
    if (recurringOnly) {
        tasks = tasks.filter((t) => t.recurring === true);
    }
    return { tasks, agentOptions, notionEnabled, notionConfigured };
}
