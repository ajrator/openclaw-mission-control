'use client';

import { useState, useCallback, memo, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { TaskStatus } from '@/lib/notion';
import type { TaskDetails } from '@/lib/notion';
import type { Task } from '@/lib/tasks';
import { AddModelForm, type AvailableToAdd } from '@/components/AddModelForm';
import { useAlertConfirm } from '@/components/AlertConfirmProvider';
import { sanitizeAgentFallbacks } from '@/lib/agent-models';

type TaskUpdatePayload = {
    status?: TaskStatus; agent?: string; important?: boolean; urgent?: boolean; dueDate?: string | null; description?: string;
    title?: string;
    recurring?: boolean; cron?: string | null; cronJobId?: string | null;
    recurUnit?: string | null; recurInterval?: number | null; recurTime?: string | null;
    recurEnd?: string | null; recurEndCount?: number | null; recurEndDate?: string | null;
};

const COLUMNS: Array<{ key: TaskStatus; label: string }> = [
    { key: 'To Do', label: 'To Do' },
    { key: 'Doing', label: 'Doing' },
    { key: 'Done', label: 'Done' },
];

const NOTION_PAGE_URL = (pageId: string) =>
    `https://www.notion.so/${pageId.replace(/-/g, '')}`;

/** Recur unit options for structured recurring (maps to Notion). */
const RECUR_UNIT_OPTIONS = [
    { value: 'Day', label: 'Day' },
    { value: 'Week', label: 'Week' },
    { value: 'Month', label: 'Month' },
    { value: 'MonthFirstWeekday', label: 'Month(s) on the First Weekday' },
    { value: 'MonthLastWeekday', label: 'Month(s) on the Last Weekday' },
    { value: 'MonthLastDay', label: 'Month(s) on the Last Day' },
    { value: 'Year', label: 'Year' },
] as const;
type RecurUnitValue = (typeof RECUR_UNIT_OPTIONS)[number]['value'];
/** Recur end options. */
const RECUR_END_OPTIONS = [{ value: 'Never', label: 'Never' }, { value: 'After', label: 'After N times' }, { value: 'Until', label: 'Until date' }] as const;
/** Common times for repeat (HH:mm). */
const RECUR_TIME_OPTIONS = ['06:00', '09:00', '12:00', '18:00'];

/** Convert structured recur (unit, interval, time) to cron for the gateway. Interval 1 only for cron; 2+ stored in Notion for display. */
function structuredToCron(unit: string, interval: number, time: string): string {
    const [hour = 9, min = 0] = (time || '09:00').split(':').map((n) => parseInt(n, 10) || 0);
    const m = Math.min(59, Math.max(0, min));
    const h = Math.min(23, Math.max(0, hour));
    const interval1 = Math.max(1, interval);
    const u = (unit || 'Day').toLowerCase();
    if (u === 'day' && interval1 === 1) return `${m} ${h} * * *`;
    if (u === 'week' && interval1 === 1) return `${m} ${h} * * 1`; // Monday
    if (u === 'month' && interval1 === 1) return `${m} ${h} 1 * *`;
    if (u === 'monthfirstweekday' && interval1 === 1) return `${m} ${h} 1 * *`; // 1st of month (first-weekday semantics need custom runner)
    if (u === 'monthlastweekday' && interval1 === 1) return `${m} ${h} 28 * *`; // fallback: 28th (last-weekday needs custom runner)
    if (u === 'monthlastday' && interval1 === 1) return `${m} ${h} L * *`; // L = last day (Quartz-style; fallback 28 if unsupported)
    if (u === 'year' && interval1 === 1) return `${m} ${h} 1 1 *`; // Jan 1
    return `${m} ${h} * * *`;
}

function recurringScheduleLabel(task: Task): string {
    if (!task.recurring) return '—';
    const u = task.recurUnit ?? 'Day';
    const i = task.recurInterval ?? 1;
    const t = task.recurTime ?? '09:00';
    const end = task.recurEnd === 'After' && task.recurEndCount != null ? `, ${task.recurEndCount} times` : task.recurEnd === 'Until' && task.recurEndDate ? ` until ${task.recurEndDate.slice(0, 10)}` : '';
    const option = RECUR_UNIT_OPTIONS.find((o) => o.value === u);
    const unitLabel = option ? option.label : u;
    const suffix = ['Day', 'Week', 'Month', 'Year'].includes(u) ? '(s)' : '';
    return `Every ${i} ${unitLabel}${suffix} at ${t}${end}`;
}

function formatDate(iso?: string): string {
    if (!iso) return '—';
    try {
        const d = new Date(iso);
        return d.toLocaleDateString(undefined, { dateStyle: 'medium' });
    } catch {
        return iso;
    }
}

/**
 * Scans text for potentially sensitive content. Returns a list of human-readable findings
 * so the user can see exactly what triggered the warning (transparent and secure).
 */
function scanForSensitiveContent(text: string): string[] {
    const findings: string[] = [];
    if (!text || text.length < 3) return findings;
    const lower = text.toLowerCase();

    const keywordGroups: Array<{ keywords: string[]; label: string }> = [
        { keywords: ['password', 'passwd', 'pwd'], label: 'Password / login credential' },
        { keywords: ['username', 'user name', 'login', 'user:', 'email:', 'e-mail:'], label: 'Username / login identifier' },
        { keywords: ['api_key', 'apikey', 'api key', 'api_secret'], label: 'API key or secret' },
        { keywords: ['secret', 'credential', 'private_key', 'private key', 'ssh key', 'secret key'], label: 'Secret or credential' },
        { keywords: ['auth_token', 'access_token', 'refresh_token', 'bearer ', 'oauth'], label: 'Auth or OAuth token' },
        { keywords: ['aws_secret', 'aws_access', 'azure_key', 'gcp_key', 'service account'], label: 'Cloud provider key' },
        { keywords: ['credit card', 'creditcard', 'card number', 'cvv', 'cvc', 'expiry'], label: 'Credit card reference' },
        { keywords: ['social security', 'ssn', 'social security number'], label: 'Social security number' },
        { keywords: ['bank account', 'account number', 'routing number', 'iban', 'swift'], label: 'Bank / financial account' },
        { keywords: ['connection string', 'connectionstring', 'mongodb://', 'postgres://', 'mysql://', 'redis://'], label: 'Database or service connection string' },
        { keywords: ['-----begin', '----- begin', 'private key', 'certificate'], label: 'Private key or certificate (PEM)' },
        { keywords: ['confidential', 'do not share', 'internal only', 'restricted', 'classified'], label: 'Confidentiality marking' },
    ];
    for (const { keywords, label } of keywordGroups) {
        if (keywords.some((k) => lower.includes(k))) findings.push(label);
    }

    if (/4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}/.test(text.replace(/\s/g, ''))) {
        findings.push('Possible credit card number (digit pattern)');
    }
    if (/\b\d{3}-\d{2}-\d{4}\b|\b\d{9}\b/.test(text) && (lower.includes('ssn') || lower.includes('social'))) {
        findings.push('Possible SSN (social security number)');
    }
    if (/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\./.test(text)) {
        findings.push('Possible JWT (JSON Web Token)');
    }
    if (/[A-Za-z0-9+/]{40,}={0,2}/.test(text)) {
        findings.push('Long base64-like string (possible key or token)');
    }
    if (/-----BEGIN [A-Z ]+-----/.test(text)) {
        findings.push('PEM-style private key or certificate');
    }

    return [...new Set(findings)];
}

interface TasksKanbanProps {
    initialTasks: Task[];
    initialAgentOptions?: string[];
    notionEnabled?: boolean;
}

export function TasksKanban({ initialTasks, initialAgentOptions = [], notionEnabled = false }: TasksKanbanProps) {
    const router = useRouter();
    const { showAlert, confirmDialog } = useAlertConfirm();
    const [tasks, setTasks] = useState<Task[]>(initialTasks);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [taskModalTask, setTaskModalTask] = useState<Task | null>(null);
    const [taskDetailsCache, setTaskDetailsCache] = useState<Record<string, TaskDetails>>({});
    const [loadingDetailsId, setLoadingDetailsId] = useState<string | null>(null);
    const [createOpen, setCreateOpen] = useState(false);
    const [agentOptions, setAgentOptions] = useState<string[]>(initialAgentOptions);
    const [createLoading, setCreateLoading] = useState(false);
    const todayIso = () => new Date().toISOString().slice(0, 10);
    const [createForm, setCreateForm] = useState({
        title: '',
        status: 'To Do' as TaskStatus,
        agent: '',
        description: '',
        dueDate: todayIso(),
        createAndStart: true,
        createAsLocalOnly: false,
        recurring: false,
        recurUnit: 'Day',
        recurInterval: 1,
        recurTime: '09:00',
        recurEnd: 'Never' as 'Never' | 'After' | 'Until',
        recurEndCount: undefined as number | undefined,
        recurEndDate: undefined as string | undefined,
        important: false,
        urgent: false,
    });
    const [createStep, setCreateStep] = useState<'task' | 'agent'>('task');
    const [newAgentForm, setNewAgentForm] = useState({ name: '', model: '', fallbacks: [] as string[] });
    const [newAgentSaving, setNewAgentSaving] = useState(false);
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [newAgentView, setNewAgentView] = useState<'create' | 'addModel'>('create');
    const [availableToAdd, setAvailableToAdd] = useState<AvailableToAdd>([]);
    const [dragOverColumn, setDragOverColumn] = useState<TaskStatus | null>(null);
    const [dragOverQuadrant, setDragOverQuadrant] = useState<'doFirst' | 'delegate' | 'schedule' | 'eliminate' | null>(null);
    const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
    const [taskStartLoading, setTaskStartLoading] = useState<Set<string>>(new Set());
    const [taskStopLoading, setTaskStopLoading] = useState<Set<string>>(new Set());
    const [pausedTaskIds, setPausedTaskIds] = useState<Set<string>>(new Set());
    const [bulkStartLoading, setBulkStartLoading] = useState(false);
    const [bulkStopLoading, setBulkStopLoading] = useState(false);
    const [refreshLoading, setRefreshLoading] = useState(false);
    const [viewMode, setViewMode] = useState<'kanban' | 'matrix' | 'recurring'>('kanban');
    const [hideDoneInMatrix, setHideDoneInMatrix] = useState(true);
    const [hideRecurringInDoing, setHideRecurringInDoing] = useState(false);
    const [cronSyncLoading, setCronSyncLoading] = useState<Set<string>>(new Set());
    const prevOpenTaskStatusRef = useRef<{ id: string | null; status: TaskStatus | null }>({ id: null, status: null });

    const getInlineCreateFallbackOptions = useCallback((index: number) => {
        const selectedElsewhere = new Set(
            newAgentForm.fallbacks.filter((_, i) => i !== index).filter(Boolean)
        );
        return availableModels.filter((m) => {
            if (m === newAgentForm.model) return false;
            const current = index >= 0 ? newAgentForm.fallbacks[index] : undefined;
            if (current === m) return true;
            return !selectedElsewhere.has(m);
        });
    }, [availableModels, newAgentForm.fallbacks, newAgentForm.model]);

    const inlineCreatePrimaryOptions = availableModels.filter(
        (m) => m === newAgentForm.model || !newAgentForm.fallbacks.includes(m)
    );
    const canAddInlineFallback = getInlineCreateFallbackOptions(-1).length > 0;

    const fetchTaskDetails = useCallback(async (taskId: string) => {
        const res = await fetch(`/api/notion/tasks/${encodeURIComponent(taskId)}/content`);
        const data = await res.json();
        if (res.ok) {
            setTaskDetailsCache((c) => ({ ...c, [taskId]: data }));
            return data as TaskDetails;
        }
        return null;
    }, []);

    const refreshTasks = useCallback(async () => {
        setRefreshLoading(true);
        try {
            const res = await fetch('/api/tasks?fresh=1');
            const data = await res.json();
            if (res.ok && Array.isArray(data.tasks)) {
                setTasks(data.tasks);
                if (Array.isArray(data.agentOptions) && data.agentOptions.length > 0) {
                    setAgentOptions(data.agentOptions);
                }
                setTaskModalTask((prev) => {
                    if (!prev) return null;
                    const updated = data.tasks.find((t: Task) => t.id === prev.id);
                    return updated ?? prev;
                });
                setTaskDetailsCache((prev) => {
                    const next = { ...prev };
                    for (const t of data.tasks as Task[]) {
                        if (next[t.id])
                            next[t.id] = { ...next[t.id], status: t.status, agent: t.agent, dueDate: t.dueDate, important: t.important, urgent: t.urgent };
                        if (t.source === 'local' && t.description != null)
                            next[t.id] = { ...next[t.id], description: t.description, body: t.description };
                    }
                    return next;
                });
            }
            router.refresh();
        } finally {
            setRefreshLoading(false);
        }
    }, [router]);

    useEffect(() => {
        const onVisible = () => {
            if (document.visibilityState === 'visible') refreshTasks();
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
    }, [refreshTasks]);

    const hasDoingTasks = tasks.some((t) => t.status === 'Doing');
    useEffect(() => {
        if (!hasDoingTasks) return;
        const interval = setInterval(() => {
            fetch('/api/tasks?fresh=1')
                .then((res) => res.ok ? res.json() : null)
                .then((data) => {
                    if (data && Array.isArray(data.tasks)) {
                        setTasks(data.tasks);
                        setTaskModalTask((prev) => {
                            if (!prev) return null;
                            const updated = data.tasks.find((t: Task) => t.id === prev.id);
                            return updated ?? prev;
                        });
                        setTaskDetailsCache((prev) => {
                            const next = { ...prev };
                            for (const t of data.tasks as Task[]) {
                                if (next[t.id])
                                    next[t.id] = { ...next[t.id], status: t.status, agent: t.agent, dueDate: t.dueDate, important: t.important, urgent: t.urgent };
                            }
                            return next;
                        });

                        const openTask = taskModalTask;
                        if (openTask?.source !== 'local') {
                            const updatedOpenTask = data.tasks.find((t: Task) => t.id === openTask.id);
                            // Refresh while running, and once more on the Doing -> Done transition
                            // so the final agent writeback appears in the modal.
                            if (updatedOpenTask && (updatedOpenTask.status === 'Doing' || openTask.status === 'Doing')) {
                                fetchTaskDetails(openTask.id).catch(() => {});
                            }
                        }
                    }
                })
                .catch(() => {});
        }, 15000);
        return () => clearInterval(interval);
    }, [fetchTaskDetails, hasDoingTasks, taskModalTask]);

    useEffect(() => {
        const prev = prevOpenTaskStatusRef.current;
        const currentId = taskModalTask?.id ?? null;
        const currentStatus = taskModalTask?.status ?? null;
        const currentSource = taskModalTask?.source;

        const transitionedOutOfDoing =
            !!taskModalTask &&
            currentSource !== 'local' &&
            prev.id === currentId &&
            prev.status === 'Doing' &&
            currentStatus !== 'Doing';

        prevOpenTaskStatusRef.current = { id: currentId, status: currentStatus };

        if (!transitionedOutOfDoing || !taskModalTask) return;

        // Final agent writeback can land right around status completion; retry a couple times
        // so the modal's Agent response reflects the Notion page body.
        fetchTaskDetails(taskModalTask.id).catch(() => {});
        const t1 = window.setTimeout(() => { fetchTaskDetails(taskModalTask.id).catch(() => {}); }, 1000);
        const t2 = window.setTimeout(() => { fetchTaskDetails(taskModalTask.id).catch(() => {}); }, 3000);
        return () => {
            window.clearTimeout(t1);
            window.clearTimeout(t2);
        };
    }, [fetchTaskDetails, taskModalTask]);

    const showTaskActionError = (res: Response, data: { error?: string }) => {
        if (res.status === 501) {
            showAlert('Start/stop not supported by the gateway yet.');
            return;
        }
        showAlert(data?.error || (res.status === 503 ? 'Gateway not available. Start OpenClaw gateway to control tasks.' : 'Request failed'));
    };

    const quadrantFlags: Record<'doFirst' | 'delegate' | 'schedule' | 'eliminate', { important: boolean; urgent: boolean }> = {
        doFirst: { important: true, urgent: true },
        delegate: { important: false, urgent: true },
        schedule: { important: true, urgent: false },
        eliminate: { important: false, urgent: false },
    };

    const byStatus = COLUMNS.reduce<Record<string, Task[]>>(
        (acc, col) => {
            acc[col.key] = tasks.filter((t) => t.status === col.key);
            return acc;
        },
        {}
    );

    const matrixTasks = hideDoneInMatrix ? tasks.filter((t) => t.status !== 'Done') : tasks;
    const byEisenhower = {
        doFirst: matrixTasks.filter((t) => t.important && t.urgent),
        delegate: matrixTasks.filter((t) => !t.important && t.urgent),
        schedule: matrixTasks.filter((t) => t.important && !t.urgent),
        eliminate: matrixTasks.filter((t) => !t.important && !t.urgent),
    };
    const recurringTasks = tasks.filter((t) => t.recurring === true);

    const toggleSelect = (id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const selectAll = () => {
        if (selectedIds.size === tasks.length) setSelectedIds(new Set());
        else setSelectedIds(new Set(tasks.map((t) => t.id)));
    };

    const openTaskModal = async (task: Task) => {
        setTaskModalTask(task);
        if (task.source === 'local') {
            setTaskDetailsCache((c) => ({
                ...c,
                [task.id]: { description: task.description ?? '', body: task.description ?? '' } as TaskDetails,
            }));
            return;
        }
        if (taskDetailsCache[task.id]) return;
        setLoadingDetailsId(task.id);
        try {
            await fetchTaskDetails(task.id);
        } finally {
            setLoadingDetailsId(null);
        }
    };

    const handleDragStart = (e: React.DragEvent, task: Task) => {
        e.dataTransfer.setData('application/json', JSON.stringify({ id: task.id, status: task.status }));
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e: React.DragEvent, columnKey: TaskStatus) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOverColumn(columnKey);
    };

    const handleDragLeave = () => setDragOverColumn(null);

    const handleDrop = async (e: React.DragEvent, newStatus: TaskStatus) => {
        e.preventDefault();
        setDragOverColumn(null);
        const raw = e.dataTransfer.getData('application/json');
        const { id, status: prevStatus } = JSON.parse(raw || '{}');
        if (!id || prevStatus === newStatus) return;
        const task = tasks.find((t) => t.id === id);
        const url = task?.source === 'local'
            ? `/api/local-tasks/${encodeURIComponent(id)}`
            : `/api/notion/tasks/${encodeURIComponent(id)}`;

        setTasks((prev) =>
            prev.map((t) => (t.id === id ? { ...t, status: newStatus } : t))
        );

        try {
            const res = await fetch(url, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus }),
            });
            if (!res.ok) {
                setTasks((prev) =>
                    prev.map((t) => (t.id === id ? { ...t, status: prevStatus } : t))
                );
                router.refresh();
            }
        } catch {
            setTasks((prev) =>
                prev.map((t) => (t.id === id ? { ...t, status: prevStatus } : t))
            );
            router.refresh();
        }
    };

    const handleMatrixDragStart = (e: React.DragEvent, task: Task) => {
        e.dataTransfer.setData(
            'application/json',
            JSON.stringify({
                id: task.id,
                important: task.important,
                urgent: task.urgent,
            })
        );
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleMatrixDragOver = (e: React.DragEvent, quadrant: 'doFirst' | 'delegate' | 'schedule' | 'eliminate') => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOverQuadrant(quadrant);
    };

    const handleMatrixDragLeave = () => setDragOverQuadrant(null);

    const handleMatrixDrop = async (
        e: React.DragEvent,
        quadrant: 'doFirst' | 'delegate' | 'schedule' | 'eliminate'
    ) => {
        e.preventDefault();
        setDragOverQuadrant(null);
        const raw = e.dataTransfer.getData('application/json');
        const { id, important: prevImportant, urgent: prevUrgent } = JSON.parse(raw || '{}');
        if (!id) return;
        const task = tasks.find((t) => t.id === id);
        const { important: newImportant, urgent: newUrgent } = quadrantFlags[quadrant];
        if (prevImportant === newImportant && prevUrgent === newUrgent) return;

        setTasks((prev) =>
            prev.map((t) =>
                t.id === id ? { ...t, important: newImportant, urgent: newUrgent } : t
            )
        );

        const url = task?.source === 'local'
            ? `/api/local-tasks/${encodeURIComponent(id)}`
            : `/api/notion/tasks/${encodeURIComponent(id)}`;
        try {
            const res = await fetch(url, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ important: newImportant, urgent: newUrgent }),
            });
            if (!res.ok) {
                setTasks((prev) =>
                    prev.map((t) =>
                        t.id === id ? { ...t, important: prevImportant, urgent: prevUrgent } : t
                    )
                );
                router.refresh();
            }
        } catch {
            setTasks((prev) =>
                prev.map((t) =>
                    t.id === id ? { ...t, important: prevImportant, urgent: prevUrgent } : t
                )
            );
            router.refresh();
        }
    };

    const removeRecurringCronAndArchive = async (taskId: string) => {
        const task = tasks.find((t) => t.id === taskId);
        const msg = task?.source === 'local' ? 'Delete this local task?' : 'Archive this task in Notion?';
        if (!(await confirmDialog({ message: msg }))) return;
        setDeletingIds((p) => new Set(p).add(taskId));
        setTasks((prev) => prev.filter((t) => t.id !== taskId));
        setSelectedIds((prev) => {
            const next = new Set(prev);
            next.delete(taskId);
            return next;
        });
        if (taskModalTask?.id === taskId) setTaskModalTask(null);
        const url = task?.source === 'local'
            ? `/api/local-tasks/${encodeURIComponent(taskId)}`
            : `/api/notion/tasks/${encodeURIComponent(taskId)}`;
        try {
            const deletePromise = fetch(url, { method: 'DELETE' });
            const cronPromise =
                task?.recurring && task?.cronJobId
                    ? fetch('/api/openclaw/cron/remove', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ cronJobId: task.cronJobId }),
                      }).catch(() => undefined)
                    : Promise.resolve(undefined);
            const [res] = await Promise.all([deletePromise, cronPromise]);
            if (!res?.ok) {
                const data = await fetch('/api/tasks').then((r) => r.json()).catch(() => ({}));
                if (Array.isArray(data.tasks)) setTasks(data.tasks);
                showAlert(res?.status === 404 || res?.status === 503 ? 'Could not archive. Please try again.' : 'Archive failed.');
            }
        } finally {
            setDeletingIds((p) => {
                const next = new Set(p);
                next.delete(taskId);
                return next;
            });
        }
    };

    const archiveTask = removeRecurringCronAndArchive;

    const syncRecurringToCron = async (t: Task) => {
        const cronExpr = (t.cron?.trim() || (t.recurUnit && t.recurTime ? structuredToCron(t.recurUnit, t.recurInterval ?? 1, t.recurTime) : '')).trim();
        if (!t.recurring || !cronExpr || !t.agent) return;
        setCronSyncLoading((p) => new Set(p).add(t.id));
        try {
            const syncRes = await fetch('/api/openclaw/cron/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    taskId: t.id,
                    source: t.source,
                    agent: t.agent,
                    name: t.title,
                    description: t.description ?? undefined,
                            schedule: { kind: 'cron' as const, expr: cronExpr },
                    cronJobId: t.cronJobId ?? undefined,
                    enabled: true,
                }),
            });
            if (syncRes.ok) {
                const syncData = await syncRes.json();
                const cronJobId = syncData.cronJobId;
                if (cronJobId) {
                    const patchUrl = t.source === 'notion' ? `/api/notion/tasks/${t.id}` : `/api/local-tasks/${t.id}`;
                    const patchRes = await fetch(patchUrl, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ cronJobId }),
                    });
                    if (patchRes.ok) {
                        setTasks((prev) =>
                            prev.map((task) => (task.id === t.id ? { ...task, cronJobId } : task))
                        );
                        setTaskModalTask((prev) => (prev?.id === t.id ? { ...prev, cronJobId } : prev));
                    }
                }
            } else {
                const err = await syncRes.json().catch(() => ({}));
                showAlert(err?.error || 'Failed to sync to cron');
            }
        } finally {
            setCronSyncLoading((p) => {
                const next = new Set(p);
                next.delete(t.id);
                return next;
            });
        }
    };

    const deleteSelected = async () => {
        const toDelete = tasks.filter((t) => selectedIds.has(t.id));
        if (toDelete.length === 0 || !(await confirmDialog({ message: `Archive/delete ${toDelete.length} task(s)?` }))) return;
        const idsToDelete = new Set(toDelete.map((t) => t.id));
        setDeletingIds((p) => new Set([...p, ...idsToDelete]));
        setTasks((prev) => prev.filter((t) => !idsToDelete.has(t.id)));
        setSelectedIds(new Set());
        if (taskModalTask && idsToDelete.has(taskModalTask.id)) setTaskModalTask(null);
        try {
            const deletePromises = toDelete.map((t) =>
                fetch(
                    t.source === 'local'
                        ? `/api/local-tasks/${encodeURIComponent(t.id)}`
                        : `/api/notion/tasks/${encodeURIComponent(t.id)}`,
                    { method: 'DELETE' }
                )
            );
            const cronRemovePromises = toDelete
                .filter((t) => t.recurring && t.cronJobId)
                .map((t) =>
                    fetch('/api/openclaw/cron/remove', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ cronJobId: t.cronJobId }),
                    }).catch(() => undefined)
                );
            const results = await Promise.all([...deletePromises, ...cronRemovePromises]);
            const deleteResults = results.slice(0, toDelete.length);
            const allSucceeded = deleteResults.every((r) => r?.ok);
            if (!allSucceeded) {
                const res = await fetch('/api/tasks');
                const data = await res.json();
                if (res.ok && Array.isArray(data.tasks)) setTasks(data.tasks);
                showAlert('Some tasks could not be archived. List refreshed.');
            }
        } finally {
            setDeletingIds(new Set());
        }
    };

    const startTask = async (taskId: string, agent?: string) => {
        const task = tasks.find((t) => t.id === taskId);
        setTaskStartLoading((p) => new Set(p).add(taskId));
        try {
            const body: { taskIds: string[]; tasks?: { notionPageId?: string; localTaskId?: string; agent?: string }[] } = {
                taskIds: [taskId],
            };
            if (agent)
                body.tasks = [task?.source === 'local' ? { localTaskId: taskId, agent } : { notionPageId: taskId, agent }];
            const res = await fetch('/api/openclaw/task/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                showTaskActionError(res, data);
            } else {
                setPausedTaskIds((p) => {
                    const next = new Set(p);
                    next.delete(taskId);
                    return next;
                });
                if (task && task.status !== 'Done') {
                    await updateTaskFromCard(taskId, { status: 'Doing' });
                    setTaskModalTask((prev) =>
                        prev?.id === taskId ? { ...prev, status: 'Doing' } : prev
                    );
                    setTaskDetailsCache((prev) =>
                        prev[taskId]
                            ? { ...prev, [taskId]: { ...prev[taskId], status: 'Doing' } }
                            : prev
                    );
                }
            }
        } finally {
            setTaskStartLoading((p) => {
                const next = new Set(p);
                next.delete(taskId);
                return next;
            });
        }
    };

    const stopTask = async (taskId: string, agent?: string) => {
        const task = tasks.find((t) => t.id === taskId);
        setTaskStopLoading((p) => new Set(p).add(taskId));
        try {
            const body: { taskIds: string[]; tasks?: { notionPageId?: string; localTaskId?: string; agent?: string }[] } = {
                taskIds: [taskId],
            };
            if (agent)
                body.tasks = [task?.source === 'local' ? { localTaskId: taskId, agent } : { notionPageId: taskId, agent }];
            const res = await fetch('/api/openclaw/task/stop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) showTaskActionError(res, data);
            else setPausedTaskIds((p) => new Set(p).add(taskId));
        } finally {
            setTaskStopLoading((p) => {
                const next = new Set(p);
                next.delete(taskId);
                return next;
            });
        }
    };

    const startSelected = async () => {
        const selected = tasks.filter((t) => selectedIds.has(t.id) && t.agent);
        if (selected.length === 0) {
            showAlert('No selected tasks have an agent assigned.');
            return;
        }
        setBulkStartLoading(true);
        try {
            const res = await fetch('/api/openclaw/task/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    taskIds: selected.map((t) => t.id),
                    tasks: selected.map((t) =>
                        t.source === 'local'
                            ? { localTaskId: t.id, agent: t.agent }
                            : { notionPageId: t.id, agent: t.agent }
                    ),
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                showTaskActionError(res, data);
            } else {
                const started = (data as { started?: string[] }).started ?? selected.map((t) => t.id);
                for (const taskId of started) {
                    const task = tasks.find((t) => t.id === taskId);
                    if (task && task.status !== 'Done') {
                        await updateTaskFromCard(taskId, { status: 'Doing' });
                        setTaskModalTask((prev) =>
                            prev?.id === taskId ? { ...prev, status: 'Doing' } : prev
                        );
                        setTaskDetailsCache((prev) =>
                            prev[taskId]
                                ? { ...prev, [taskId]: { ...prev[taskId], status: 'Doing' } }
                                : prev
                        );
                    }
                }
            }
        } finally {
            setBulkStartLoading(false);
        }
    };

    const stopSelected = async () => {
        const selected = tasks.filter((t) => selectedIds.has(t.id) && t.agent);
        if (selected.length === 0) {
            showAlert('No selected tasks have an agent assigned.');
            return;
        }
        setBulkStopLoading(true);
        try {
            const res = await fetch('/api/openclaw/task/stop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    taskIds: selected.map((t) => t.id),
                    tasks: selected.map((t) =>
                        t.source === 'local'
                            ? { localTaskId: t.id, agent: t.agent }
                            : { notionPageId: t.id, agent: t.agent }
                    ),
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) showTaskActionError(res, data);
        } finally {
            setBulkStopLoading(false);
        }
    };

const openCreateModal = async () => {
        setCreateOpen(true);
        setCreateStep('task');
        setCreateForm((f) => ({ ...f, dueDate: todayIso(), createAndStart: true, createAsLocalOnly: !notionEnabled }));
        setNewAgentForm({ name: '', model: '', fallbacks: [] });
        try {
            const [tasksRes, openclawRes] = await Promise.all([
                fetch('/api/tasks'),
                fetch('/api/openclaw'),
            ]);
            const tasksData = await tasksRes.json();
            if (tasksRes.ok && Array.isArray(tasksData.agentOptions)) {
                setAgentOptions(tasksData.agentOptions);
                setCreateForm((f) => ({
                    ...f,
                    agent: tasksData.agentOptions.includes(f.agent) ? f.agent : tasksData.agentOptions[0] || '',
                }));
            } else if (agentOptions.length === 0) setAgentOptions([]);
            const openclawData = await openclawRes.json().catch(() => ({}));
            if (openclawRes.ok && Array.isArray(openclawData.availableModels)) {
                const models = openclawData.availableModels;
                setAvailableModels(models);
                setNewAgentForm((f) => ({ ...f, model: f.model || models[0] || '' }));
            } else {
                setAvailableModels([]);
            }
        } catch {
            if (agentOptions.length === 0) setAgentOptions([]);
        }
    };

    const createAgentInline = async (e: React.FormEvent) => {
        e.preventDefault();
        const name = newAgentForm.name.trim();
        if (!name || !newAgentForm.model) return;
        setNewAgentSaving(true);
        try {
            const sanitizedFallbacks = sanitizeAgentFallbacks(newAgentForm.model, newAgentForm.fallbacks);
            const res = await fetch('/api/openclaw/agent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    model: newAgentForm.model,
                    fallbacks: sanitizedFallbacks,
                }),
            });
            if (res.ok) {
                setAgentOptions((prev) => (prev.includes(name) ? prev : [...prev, name]));
                setCreateForm((f) => ({ ...f, agent: name }));
                setCreateStep('task');
                setNewAgentForm({ name: '', model: availableModels[0] || '', fallbacks: [] });
                router.refresh();
            } else {
                const err = await res.json().catch(() => ({}));
                showAlert(err?.error || 'Error creating agent');
            }
        } finally {
            setNewAgentSaving(false);
        }
    };

    const updateTaskFromCard = useCallback(async (taskId: string, payload: TaskUpdatePayload) => {
        const prevTask = tasks.find((t) => t.id === taskId);
        const task = prevTask;
        const url = task?.source === 'local'
            ? `/api/local-tasks/${encodeURIComponent(taskId)}`
            : `/api/notion/tasks/${encodeURIComponent(taskId)}`;
        setTasks((prev) =>
            prev.map((t) =>
                t.id === taskId
                    ? {
                          ...t,
                          ...payload,
                          dueDate: payload.dueDate === null ? undefined : (payload.dueDate ?? t.dueDate),
                      }
                    : t
            )
        );
        if (taskModalTask?.id === taskId) {
            setTaskModalTask((prev) =>
                prev?.id === taskId
                    ? {
                          ...prev,
                          ...payload,
                          dueDate: payload.dueDate === null ? undefined : (payload.dueDate ?? prev.dueDate),
                      }
                    : prev
            );
        }
        if (payload.description !== undefined) {
            setTaskDetailsCache((prev) => ({
                ...prev,
                [taskId]: prev[taskId]
                    ? { ...prev[taskId], description: payload.description, body: payload.description ?? prev[taskId].body }
                    : ({ description: payload.description, body: payload.description ?? '' } as TaskDetails),
            }));
        }
        try {
            const res = await fetch(url, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok && prevTask) {
                setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...prevTask } : t)));
                const err = await res.json().catch(() => ({}));
                showAlert(err.error || 'Update failed');
                return;
            }
            const effectiveRecurring = payload.recurring ?? prevTask?.recurring;
            const effectiveCron = payload.cron !== undefined ? payload.cron : prevTask?.cron;
            const hadCronJobId = !!prevTask?.cronJobId;
            if (effectiveRecurring && effectiveCron?.trim() && prevTask?.agent) {
                try {
                    const syncRes = await fetch('/api/openclaw/cron/sync', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            taskId,
                            source: prevTask.source,
                            agent: payload.agent ?? prevTask.agent,
                            name: payload.title ?? prevTask.title,
                            description: taskDetailsCache[taskId]?.description ?? prevTask.description ?? undefined,
                            schedule: { kind: 'cron' as const, expr: effectiveCron.trim() },
                            cronJobId: prevTask.cronJobId ?? undefined,
                            enabled: true,
                        }),
                    });
                    if (syncRes.ok) {
                        const syncData = await syncRes.json();
                        const cronJobId = syncData.cronJobId;
                        if (cronJobId) {
                            await fetch(url, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ cronJobId }),
                            });
                            setTasks((prev) =>
                                prev.map((t) => (t.id === taskId ? { ...t, cronJobId } : t))
                            );
                            setTaskModalTask((prev) => (prev?.id === taskId ? { ...prev, cronJobId } : prev));
                        }
                    }
                } catch {
                    // cron sync failed; task update still applied
                }
            } else if (hadCronJobId && (!effectiveRecurring || !effectiveCron?.trim())) {
                try {
                    await fetch('/api/openclaw/cron/remove', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ cronJobId: prevTask.cronJobId }),
                    });
                } catch {
                    // continue
                }
                await fetch(url, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cronJobId: null }),
                });
                setTasks((prev) =>
                    prev.map((t) => (t.id === taskId ? { ...t, cronJobId: undefined } : t))
                );
                setTaskModalTask((prev) => (prev?.id === taskId ? { ...prev, cronJobId: undefined } : prev));
            }
        } catch (e) {
            if (prevTask) setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...prevTask } : t)));
            showAlert(e instanceof Error ? e.message : 'Update failed');
        }
    }, [tasks, taskDetailsCache, showAlert, taskModalTask?.id]);

    const createTask = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!createForm.title.trim() || !createForm.agent.trim() || !createForm.description.trim()) return;
        const effectiveCron = createForm.recurring
            ? structuredToCron(createForm.recurUnit ?? 'Day', createForm.recurInterval ?? 1, createForm.recurTime ?? '09:00')
            : '';
        if (createForm.recurring && !effectiveCron) {
            showAlert('Please set when this task should repeat (unit, interval, time).');
            return;
        }
        setCreateLoading(true);
        const createInNotion = notionEnabled && !createForm.createAsLocalOnly;
        const url = createInNotion ? '/api/notion/tasks' : '/api/local-tasks';
        const body: Record<string, unknown> = {
            title: createForm.title.trim(),
            status: createForm.createAndStart ? 'Doing' : 'To Do',
            agent: createForm.agent.trim(),
            description: createForm.description.trim(),
            dueDate: createForm.dueDate || null,
            important: createForm.important,
            urgent: createForm.urgent,
        };
        if (createForm.recurring) {
            body.recurring = true;
            body.cron = effectiveCron;
            body.recurUnit = createForm.recurUnit ?? 'Day';
            body.recurInterval = createForm.recurInterval ?? 1;
            body.recurTime = createForm.recurTime ?? '09:00';
            body.recurEnd = createForm.recurEnd ?? 'Never';
            body.recurEndCount = createForm.recurEnd === 'After' ? (createForm.recurEndCount ?? undefined) : undefined;
            body.recurEndDate = createForm.recurEnd === 'Until' && createForm.recurEndDate ? createForm.recurEndDate : undefined;
        }
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (res.ok) {
                const raw = await res.json();
                const task: Task = createInNotion
                    ? {
                          id: raw.task.id,
                          source: 'notion',
                          notionPageId: raw.task.id,
                          title: raw.task.title,
                          status: raw.task.status,
                          agent: raw.task.agent,
                          important: raw.task.important,
                          urgent: raw.task.urgent,
                          dueDate: raw.task.dueDate,
                          recurring: raw.task.recurring,
                          cron: raw.task.cron,
                          cronJobId: raw.task.cronJobId,
                      }
                    : {
                          id: raw.id,
                          source: 'local',
                          title: raw.title,
                          status: raw.status,
                          agent: raw.agent,
                          description: raw.description,
                          important: raw.important,
                          urgent: raw.urgent,
                          dueDate: raw.dueDate,
                          recurring: raw.recurring,
                          cron: raw.cron,
                          cronJobId: raw.cronJobId,
                      };
                if (createForm.recurring && effectiveCron) {
                    try {
                        const syncRes = await fetch('/api/openclaw/cron/sync', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                taskId: task.id,
                                source: task.source,
                                agent: task.agent,
                                name: task.title,
                                description: task.description ?? createForm.description.trim(),
                                schedule: { kind: 'cron' as const, expr: effectiveCron },
                                enabled: true,
                            }),
                        });
                        if (syncRes.ok) {
                            const syncData = await syncRes.json();
                            const cronJobId = syncData.cronJobId;
                            if (cronJobId) {
                                task.cronJobId = cronJobId;
                                const patchUrl = task.source === 'notion' ? `/api/notion/tasks/${task.id}` : `/api/local-tasks/${task.id}`;
                                await fetch(patchUrl, {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ cronJobId }),
                                });
                            }
                        }
                    } catch {
                        // cron sync failed; task still created
                    }
                }
                setTasks((prev) => [...prev, task]);
                setCreateOpen(false);
                setCreateForm((f) => ({
                    ...f,
                    title: '',
                    agent: agentOptions[0] || '',
                    description: '',
                    dueDate: todayIso(),
                    createAndStart: true,
                    createAsLocalOnly: !notionEnabled,
                    recurring: false,
                    recurUnit: 'Day',
                    recurInterval: 1,
                    recurTime: '09:00',
                    recurEnd: 'Never',
                    recurEndCount: undefined,
                    recurEndDate: undefined,
                    important: false,
                    urgent: false,
                }));

                if (createForm.createAndStart && !createForm.recurring && task.id && task.agent) {
                    await startTask(task.id, task.agent);
                }
            } else {
                const err = await res.json().catch(() => ({}));
                showAlert(err.error || 'Failed to create task');
            }
        } finally {
            setCreateLoading(false);
        }
    };

    return (
        <>
            <div className="tasks-toolbar">
                <div className="tasks-toolbar-actions">
                    <div className="tasks-view-toggle" role="tablist" aria-label="Task view">
                        <button
                            type="button"
                            role="tab"
                            aria-selected={viewMode === 'kanban'}
                            className={viewMode === 'kanban' ? 'tasks-view-tab active' : 'tasks-view-tab'}
                            onClick={() => setViewMode('kanban')}
                        >
                            Kanban
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={viewMode === 'matrix'}
                            className={viewMode === 'matrix' ? 'tasks-view-tab active' : 'tasks-view-tab'}
                            onClick={() => setViewMode('matrix')}
                        >
                            Eisenhower Matrix
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={viewMode === 'recurring'}
                            className={viewMode === 'recurring' ? 'tasks-view-tab active' : 'tasks-view-tab'}
                            onClick={() => setViewMode('recurring')}
                        >
                            Recurring
                        </button>
                    </div>
                    <button
                        type="button"
                        className="btn-secondary"
                        onClick={refreshTasks}
                        disabled={refreshLoading}
                        title="Refresh tasks (e.g. after agent updates status to Done)"
                        aria-label="Refresh tasks"
                    >
                        {refreshLoading ? 'Refreshing…' : 'Refresh'}
                    </button>
                    <button type="button" className="btn-primary" onClick={openCreateModal}>
                        New task
                    </button>
                    {selectedIds.size > 0 && (
                        <>
                            <button
                                type="button"
                                className="btn-secondary"
                                onClick={startSelected}
                                disabled={bulkStartLoading || bulkStopLoading || tasks.filter((t) => selectedIds.has(t.id) && t.agent).length === 0}
                            >
                                {bulkStartLoading ? 'Starting…' : 'Start selected'}
                            </button>
                            <button
                                type="button"
                                className="btn-secondary"
                                onClick={stopSelected}
                                disabled={bulkStartLoading || bulkStopLoading || tasks.filter((t) => selectedIds.has(t.id) && t.agent).length === 0}
                            >
                                {bulkStopLoading ? 'Stopping…' : 'Stop selected'}
                            </button>
                            <button
                                type="button"
                                className="btn-danger"
                                onClick={deleteSelected}
                                disabled={deletingIds.size > 0}
                            >
                                Delete selected ({selectedIds.size})
                            </button>
                        </>
                    )}
                </div>
                {tasks.length > 0 && (
                    <button
                        type="button"
                        className="tasks-select-all"
                        onClick={selectAll}
                    >
                        {selectedIds.size === tasks.length ? 'Deselect all' : 'Select all'}
                    </button>
                )}
            </div>

            {viewMode === 'matrix' && (
                <div className="eisenhower-matrix" role="region" aria-label="Eisenhower Matrix">
                    <div className="eisenhower-matrix-toolbar">
                        <label className="eisenhower-filter-done">
                            <input
                                type="checkbox"
                                checked={hideDoneInMatrix}
                                onChange={(e) => setHideDoneInMatrix(e.target.checked)}
                                aria-label="Hide done tasks in matrix"
                            />
                            <span>Hide done tasks</span>
                        </label>
                        {hideDoneInMatrix && (
                            <span className="eisenhower-filter-hint">
                                Showing {matrixTasks.length} of {tasks.length} tasks
                            </span>
                        )}
                    </div>
                    <div className="eisenhower-axes">
                        <span className="eisenhower-axis-label eisenhower-axis-urgent">Urgent</span>
                        <span className="eisenhower-axis-label eisenhower-axis-important">Important</span>
                    </div>
                    <div className="eisenhower-grid">
                        <div
                            className={`eisenhower-quadrant eisenhower-quadrant-do-first ${dragOverQuadrant === 'doFirst' ? 'eisenhower-quadrant-drag-over' : ''}`}
                            onDragOver={(e) => handleMatrixDragOver(e, 'doFirst')}
                            onDragLeave={handleMatrixDragLeave}
                            onDrop={(e) => handleMatrixDrop(e, 'doFirst')}
                        >
                            <h3 className="eisenhower-quadrant-title">Do first</h3>
                            <p className="eisenhower-quadrant-hint">Urgent &amp; important</p>
                            <div className="eisenhower-quadrant-cards">
                                {byEisenhower.doFirst.map((task) => (
                                    <KanbanCard
                                        key={task.id}
                                        task={task}
                                        agentOptions={agentOptions}
                                        isSelected={selectedIds.has(task.id)}
                                        isDeleting={deletingIds.has(task.id)}
                                        onToggleSelect={() => toggleSelect(task.id)}
                                        onClick={() => openTaskModal(task)}
                                        onArchive={() => archiveTask(task.id)}
                                        onUpdate={(payload) => updateTaskFromCard(task.id, payload)}
                                        onDragStart={(e) => handleMatrixDragStart(e, task)}
                                        onStart={() => startTask(task.id, task.agent)}
                                        onStop={() => stopTask(task.id, task.agent)}
                                        isStartLoading={taskStartLoading.has(task.id)}
                                        isStopLoading={taskStopLoading.has(task.id)}
                                        pausedTaskIds={pausedTaskIds}
                                        draggable={true}
                                    />
                                ))}
                            </div>
                        </div>
                        <div
                            className={`eisenhower-quadrant eisenhower-quadrant-schedule ${dragOverQuadrant === 'schedule' ? 'eisenhower-quadrant-drag-over' : ''}`}
                            onDragOver={(e) => handleMatrixDragOver(e, 'schedule')}
                            onDragLeave={handleMatrixDragLeave}
                            onDrop={(e) => handleMatrixDrop(e, 'schedule')}
                        >
                            <h3 className="eisenhower-quadrant-title">Schedule</h3>
                            <p className="eisenhower-quadrant-hint">Important, not urgent</p>
                            <div className="eisenhower-quadrant-cards">
                                {byEisenhower.schedule.map((task) => (
                                    <KanbanCard
                                        key={task.id}
                                        task={task}
                                        agentOptions={agentOptions}
                                        isSelected={selectedIds.has(task.id)}
                                        isDeleting={deletingIds.has(task.id)}
                                        onToggleSelect={() => toggleSelect(task.id)}
                                        onClick={() => openTaskModal(task)}
                                        onArchive={() => archiveTask(task.id)}
                                        onUpdate={(payload) => updateTaskFromCard(task.id, payload)}
                                        onDragStart={(e) => handleMatrixDragStart(e, task)}
                                        onStart={() => startTask(task.id, task.agent)}
                                        onStop={() => stopTask(task.id, task.agent)}
                                        isStartLoading={taskStartLoading.has(task.id)}
                                        isStopLoading={taskStopLoading.has(task.id)}
                                        pausedTaskIds={pausedTaskIds}
                                        draggable={true}
                                    />
                                ))}
                            </div>
                        </div>
                        <div
                            className={`eisenhower-quadrant eisenhower-quadrant-delegate ${dragOverQuadrant === 'delegate' ? 'eisenhower-quadrant-drag-over' : ''}`}
                            onDragOver={(e) => handleMatrixDragOver(e, 'delegate')}
                            onDragLeave={handleMatrixDragLeave}
                            onDrop={(e) => handleMatrixDrop(e, 'delegate')}
                        >
                            <h3 className="eisenhower-quadrant-title">Delegate</h3>
                            <p className="eisenhower-quadrant-hint">Urgent, not important</p>
                            <div className="eisenhower-quadrant-cards">
                                {byEisenhower.delegate.map((task) => (
                                    <KanbanCard
                                        key={task.id}
                                        task={task}
                                        agentOptions={agentOptions}
                                        isSelected={selectedIds.has(task.id)}
                                        isDeleting={deletingIds.has(task.id)}
                                        onToggleSelect={() => toggleSelect(task.id)}
                                        onClick={() => openTaskModal(task)}
                                        onArchive={() => archiveTask(task.id)}
                                        onUpdate={(payload) => updateTaskFromCard(task.id, payload)}
                                        onDragStart={(e) => handleMatrixDragStart(e, task)}
                                        onStart={() => startTask(task.id, task.agent)}
                                        onStop={() => stopTask(task.id, task.agent)}
                                        isStartLoading={taskStartLoading.has(task.id)}
                                        isStopLoading={taskStopLoading.has(task.id)}
                                        pausedTaskIds={pausedTaskIds}
                                        draggable={true}
                                    />
                                ))}
                            </div>
                        </div>
                        <div
                            className={`eisenhower-quadrant eisenhower-quadrant-eliminate ${dragOverQuadrant === 'eliminate' ? 'eisenhower-quadrant-drag-over' : ''}`}
                            onDragOver={(e) => handleMatrixDragOver(e, 'eliminate')}
                            onDragLeave={handleMatrixDragLeave}
                            onDrop={(e) => handleMatrixDrop(e, 'eliminate')}
                        >
                            <h3 className="eisenhower-quadrant-title">Eliminate</h3>
                            <p className="eisenhower-quadrant-hint">Not urgent, not important</p>
                            <div className="eisenhower-quadrant-cards">
                                {byEisenhower.eliminate.map((task) => (
                                    <KanbanCard
                                        key={task.id}
                                        task={task}
                                        agentOptions={agentOptions}
                                        isSelected={selectedIds.has(task.id)}
                                        isDeleting={deletingIds.has(task.id)}
                                        onToggleSelect={() => toggleSelect(task.id)}
                                        onClick={() => openTaskModal(task)}
                                        onArchive={() => archiveTask(task.id)}
                                        onUpdate={(payload) => updateTaskFromCard(task.id, payload)}
                                        onDragStart={(e) => handleMatrixDragStart(e, task)}
                                        onStart={() => startTask(task.id, task.agent)}
                                        onStop={() => stopTask(task.id, task.agent)}
                                        isStartLoading={taskStartLoading.has(task.id)}
                                        isStopLoading={taskStopLoading.has(task.id)}
                                        pausedTaskIds={pausedTaskIds}
                                        draggable={true}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {viewMode === 'recurring' && (
                <div className="recurring-view" role="region" aria-label="Recurring tasks">
                    {recurringTasks.length === 0 ? (
                        <div className="empty-state">
                            <p>No recurring tasks.</p>
                            <p className="page-subtitle" style={{ marginTop: 8 }}>Create a task with Recurring and choose when it repeats, or mark an existing task as recurring.</p>
                        </div>
                    ) : (
                        <div className="recurring-grid">
                            {recurringTasks.map((task) => (
                                <div key={task.id} className="recurring-card">
                                    <div className="recurring-card-header">
                                        <h3 className="recurring-card-title">{task.title}</h3>
                                        <span className="recurring-card-source">{task.source === 'notion' ? 'Notion' : 'Local'}</span>
                                    </div>
                                    <div className="recurring-card-meta">
                                        <span className="recurring-card-agent">{task.agent ?? '—'}</span>
                                        <span className="recurring-card-cron" title="Schedule">{recurringScheduleLabel(task)}</span>
                                    </div>
                                    {task.cronJobId && (
                                        <p className="recurring-card-synced">Synced to gateway</p>
                                    )}
                                    <div className="recurring-card-actions">
                                        {task.recurring && (task.cron?.trim() || (task.recurUnit && task.recurTime)) && task.agent && (
                                            <button
                                                type="button"
                                                className="btn-secondary btn-sm"
                                                onClick={() => syncRecurringToCron(task)}
                                                disabled={cronSyncLoading.has(task.id)}
                                                aria-label="Sync to cron"
                                            >
                                                {cronSyncLoading.has(task.id) ? 'Syncing…' : task.cronJobId ? 'Re-sync' : 'Sync to cron'}
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            className="btn-secondary btn-sm"
                                            onClick={() => openTaskModal(task)}
                                            aria-label="Open task"
                                        >
                                            Open
                                        </button>
                                        <button
                                            type="button"
                                            className="btn-danger btn-sm"
                                            onClick={() => archiveTask(task.id)}
                                            disabled={deletingIds.has(task.id)}
                                            aria-label="Delete task"
                                        >
                                            {deletingIds.has(task.id) ? 'Deleting…' : 'Delete'}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
            {viewMode === 'kanban' && (
            <div className="kanban-board">
                {COLUMNS.map((col) => {
                    const columnTasks = col.key === 'Doing' && hideRecurringInDoing
                        ? (byStatus[col.key] ?? []).filter((t) => !t.recurring)
                        : (byStatus[col.key] ?? []);
                    return (
                    <div
                        key={col.key}
                        className={`kanban-column ${dragOverColumn === col.key ? 'kanban-column-drag-over' : ''}`}
                        onDragOver={(e) => handleDragOver(e, col.key)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, col.key)}
                    >
                        <div className="kanban-column-header">
                            <span className="kanban-column-title">{col.label}</span>
                            <div className="kanban-column-header-right">
                                {col.key === 'Doing' && (
                                    <label className="kanban-doing-hide-recurring" title="Hide recurring tasks in this column">
                                        <input
                                            type="checkbox"
                                            checked={hideRecurringInDoing}
                                            onChange={(e) => setHideRecurringInDoing(e.target.checked)}
                                            aria-label="Hide recurring in Doing"
                                        />
                                        <span>Hide recurring</span>
                                    </label>
                                )}
                                <span className="kanban-column-count">
                                    {columnTasks.length}
                                </span>
                            </div>
                        </div>
                        <div className="kanban-column-cards">
                            {columnTasks.map((task) => (
                                <KanbanCard
                                    key={task.id}
                                    task={task}
                                    agentOptions={agentOptions}
                                    isSelected={selectedIds.has(task.id)}
                                    isDeleting={deletingIds.has(task.id)}
                                    onToggleSelect={() => toggleSelect(task.id)}
                                    onClick={() => openTaskModal(task)}
                                    onArchive={() => archiveTask(task.id)}
                                    onUpdate={(payload) => updateTaskFromCard(task.id, payload)}
                                    onDragStart={(e) => handleDragStart(e, task)}
                                    onStart={() => startTask(task.id, task.agent)}
                                    onStop={() => stopTask(task.id, task.agent)}
                                    isStartLoading={taskStartLoading.has(task.id)}
                                    isStopLoading={taskStopLoading.has(task.id)}
                                    pausedTaskIds={pausedTaskIds}
                                />
                            ))}
                        </div>
                    </div>
                    );
                })}
            </div>
            )}

            {taskModalTask && (
                <div className="modal-backdrop" onClick={() => setTaskModalTask(null)}>
                    <div className="modal task-detail-modal" onClick={(e) => e.stopPropagation()}>
                        <TaskDetailModal
                            task={taskModalTask}
                            details={taskDetailsCache[taskModalTask.id]}
                            isLoading={loadingDetailsId === taskModalTask.id}
                            onClose={() => setTaskModalTask(null)}
                            notionUrl={taskModalTask.source === 'notion' ? NOTION_PAGE_URL(taskModalTask.id) : undefined}
                            onStart={() => startTask(taskModalTask.id, taskModalTask.agent)}
                            onStop={() => stopTask(taskModalTask.id, taskModalTask.agent)}
                            isStartLoading={taskStartLoading.has(taskModalTask.id)}
                            isStopLoading={taskStopLoading.has(taskModalTask.id)}
                            onUpdateTask={async (payload) => updateTaskFromCard(taskModalTask.id, payload)}
                            agentOptions={agentOptions}
                            isAgentEditable={taskModalTask.status !== 'Done' && (taskModalTask.status !== 'Doing' || pausedTaskIds.has(taskModalTask.id))}
                            isPaused={pausedTaskIds.has(taskModalTask.id)}
                        />
                    </div>
                </div>
            )}

            {createOpen && (
                <div className="modal-backdrop" onClick={() => { setCreateOpen(false); setCreateStep('task'); setNewAgentView('create'); setNewAgentForm({ name: '', model: '', fallbacks: [] }); setCreateForm((f) => ({ ...f, dueDate: todayIso(), recurring: false, recurUnit: 'Day', recurInterval: 1, recurTime: '09:00', recurEnd: 'Never', important: false, urgent: false })); }}>
                    <div className="modal create-task-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="create-task-modal-header">
                            <h2 className="modal-title">
                                {createStep === 'task' ? 'New task' : newAgentView === 'addModel' ? 'New task — Add model' : 'New task — Create agent'}
                            </h2>
                            {createStep === 'task' && notionEnabled && (
                                <label className="create-task-save-to-notion-toggle">
                                    <img src="/images/notion-favicon.ico" alt="" aria-hidden width={18} height={18} />
                                    <span>Save to Notion</span>
                                    <span className="create-task-save-to-notion-track">
                                        <input
                                            type="checkbox"
                                            checked={!createForm.createAsLocalOnly}
                                            onChange={(e) => setCreateForm((f) => ({ ...f, createAsLocalOnly: !e.target.checked }))}
                                            aria-label="Save to Notion"
                                            className="create-task-save-to-notion-switch"
                                        />
                                    </span>
                                </label>
                            )}
                        </div>
                        {createStep === 'task' ? (
                            <form onSubmit={createTask}>
                                <div className="create-task-modal-body">
                                    <div className="form-group">
                                        <label htmlFor="create-title">Title</label>
                                        <input
                                            id="create-title"
                                            type="text"
                                            className="form-input"
                                            value={createForm.title}
                                            onChange={(e) => setCreateForm((f) => ({ ...f, title: e.target.value }))}
                                            placeholder="Task title"
                                            required
                                            autoFocus
                                        />
                                    </div>
                                    <div className="form-group">
                                        <div className="form-label-row">
                                            <label htmlFor="create-agent">Agent</label>
                                            <button
                                                type="button"
                                                className="btn-link"
                                                onClick={() => {
                                                    setCreateStep('agent');
                                                    setNewAgentView('create');
                                                    setNewAgentForm((f) => ({ ...f, model: f.model || availableModels[0] || '' }));
                                                }}
                                            >
                                                Create new agent
                                            </button>
                                        </div>
                                        <select
                                            id="create-agent"
                                            className="form-input"
                                            value={createForm.agent}
                                            onChange={(e) => setCreateForm((f) => ({ ...f, agent: e.target.value }))}
                                            required
                                        >
                                            <option value="">Select agent…</option>
                                            {agentOptions.map((name) => (
                                                <option key={name} value={name}>{name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="create-task-recurring-row">
                                        <label className="task-detail-toggle">
                                            <input
                                                type="checkbox"
                                                checked={createForm.recurring}
                                                onChange={(e) => setCreateForm((f) => ({ ...f, recurring: e.target.checked }))}
                                                aria-label="Recurring task"
                                            />
                                            <span>Recurring</span>
                                        </label>
                                        {createForm.recurring && (
                                            <div className="create-task-modal-recurring-block">
                                                <div className="create-task-modal-recurring-row create-task-modal-recurring-row-single">
                                                    <span className="create-task-modal-recurring-label">Repeat every</span>
                                                    <input
                                                        id="create-recur-interval"
                                                        type="text"
                                                        inputMode="numeric"
                                                        pattern="[0-9]*"
                                                        className="form-input create-task-recur-input-num"
                                                        value={String(createForm.recurInterval ?? 1)}
                                                        onChange={(e) => {
                                                            const v = e.target.value.replace(/\D/g, '');
                                                            const n = v === '' ? 1 : Math.max(1, Math.min(99, parseInt(v, 10) || 1));
                                                            setCreateForm((f) => ({ ...f, recurInterval: v === '' ? 1 : n }));
                                                        }}
                                                        aria-label="Interval"
                                                    />
                                                    <select
                                                        id="create-recur-unit"
                                                        className="form-input create-task-recur-select"
                                                        value={createForm.recurUnit ?? 'Day'}
                                                        onChange={(e) => setCreateForm((f) => ({ ...f, recurUnit: e.target.value as RecurUnitValue }))}
                                                        aria-label="Unit"
                                                    >
                                                        {RECUR_UNIT_OPTIONS.map((o) => (
                                                            <option key={o.value} value={o.value}>{o.label}</option>
                                                        ))}
                                                    </select>
                                                    <span className="create-task-modal-recurring-label">at</span>
                                                    <select
                                                        id="create-recur-time"
                                                        className="form-input create-task-recur-select create-task-recur-time"
                                                        value={createForm.recurTime ?? '09:00'}
                                                        onChange={(e) => setCreateForm((f) => ({ ...f, recurTime: e.target.value }))}
                                                        aria-label="Time"
                                                    >
                                                        {RECUR_TIME_OPTIONS.map((t) => (
                                                            <option key={t} value={t}>{t}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div className="create-task-modal-recurring-row">
                                                    <span className="create-task-modal-recurring-label">End</span>
                                                    <select
                                                        id="create-recur-end"
                                                        className="form-input create-task-recur-select"
                                                        value={createForm.recurEnd ?? 'Never'}
                                                        onChange={(e) => setCreateForm((f) => ({ ...f, recurEnd: e.target.value as 'Never' | 'After' | 'Until' }))}
                                                        aria-label="When to stop"
                                                    >
                                                        {RECUR_END_OPTIONS.map((o) => (
                                                            <option key={o.value} value={o.value}>{o.label}</option>
                                                        ))}
                                                    </select>
                                                    {createForm.recurEnd === 'After' && (
                                                        <>
                                                            <input
                                                                type="text"
                                                                inputMode="numeric"
                                                                pattern="[0-9]*"
                                                                className="form-input create-task-recur-input-num"
                                                                placeholder="N"
                                                                value={createForm.recurEndCount ?? ''}
                                                                onChange={(e) => {
                                                                    const v = e.target.value.replace(/\D/g, '');
                                                                    setCreateForm((f) => ({ ...f, recurEndCount: v === '' ? undefined : Math.max(1, Math.min(999, parseInt(v, 10) || 1)) }));
                                                                }}
                                                            />
                                                            <span className="create-task-modal-recurring-label">times</span>
                                                        </>
                                                    )}
                                                    {createForm.recurEnd === 'Until' && (
                                                        <input
                                                            type="date"
                                                            className="form-input"
                                                            style={{ width: 'auto', minWidth: 120 }}
                                                            value={createForm.recurEndDate ?? ''}
                                                            onChange={(e) => setCreateForm((f) => ({ ...f, recurEndDate: e.target.value || undefined }))}
                                                        />
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    <div className="form-group">
                                        <label htmlFor="create-due">Due date</label>
                                        <input
                                            id="create-due"
                                            type="date"
                                            className="form-input"
                                            value={createForm.dueDate}
                                            onChange={(e) => setCreateForm((f) => ({ ...f, dueDate: e.target.value }))}
                                            aria-label="Due date"
                                        />
                                    </div>
                                    <div className="task-detail-toggles">
                                        <label className="task-detail-toggle">
                                            <input
                                                type="checkbox"
                                                checked={createForm.important}
                                                onChange={(e) => setCreateForm((f) => ({ ...f, important: e.target.checked }))}
                                                aria-label="Important"
                                            />
                                            <span>Important</span>
                                        </label>
                                        <label className="task-detail-toggle">
                                            <input
                                                type="checkbox"
                                                checked={createForm.urgent}
                                                onChange={(e) => setCreateForm((f) => ({ ...f, urgent: e.target.checked }))}
                                                aria-label="Urgent"
                                            />
                                            <span>Urgent</span>
                                        </label>
                                    </div>
                                    <div className="form-group create-task-description-group">
                                        <label htmlFor="create-description">Description</label>
                                        <textarea
                                            id="create-description"
                                            className="form-input form-textarea"
                                            value={createForm.description}
                                            onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
                                            placeholder="What needs to be done"
                                            rows={5}
                                            required
                                        />
                                    </div>
                                    <div className="create-task-recurring-row">
                                        <label className="task-detail-toggle">
                                            <input
                                                type="checkbox"
                                                checked={createForm.createAndStart}
                                                onChange={(e) => setCreateForm((f) => ({ ...f, createAndStart: e.target.checked }))}
                                                aria-label="Create and Execute"
                                            />
                                            <span>Create and Execute</span>
                                        </label>
                                    </div>
                                </div>
                                <div className="modal-actions" style={{ flexShrink: 0 }}>
                                    <button type="button" className="btn-secondary" onClick={() => { setCreateOpen(false); setCreateStep('task'); setCreateForm((f) => ({ ...f, dueDate: todayIso(), recurring: false, recurUnit: 'Day', recurInterval: 1, recurTime: '09:00', recurEnd: 'Never', important: false, urgent: false })); }}>
                                        Cancel
                                    </button>
                                    <button type="submit" className="btn-primary" disabled={createLoading || !createForm.description.trim()}>
                                        {createLoading
                                            ? createForm.createAndStart
                                                ? 'Executing…'
                                                : 'Creating…'
                                            : createForm.createAndStart
                                                ? 'Execute'
                                                : 'Create'}
                                    </button>
                                </div>
                            </form>
                        ) : newAgentView === 'addModel' ? (
                            <AddModelForm
                                availableToAdd={availableToAdd}
                                backLabel="Back"
                                onSuccess={async (newModelId) => {
                                    setNewAgentView('create');
                                    if (newModelId) {
                                        const res = await fetch('/api/openclaw');
                                        const d = await res.json().catch(() => ({}));
                                        if (res.ok && Array.isArray(d.availableModels)) {
                                            setAvailableModels(d.availableModels);
                                            setNewAgentForm((f) => ({
                                                ...f,
                                                model: newModelId,
                                                fallbacks: sanitizeAgentFallbacks(newModelId, f.fallbacks),
                                            }));
                                        }
                                    }
                                    router.refresh();
                                }}
                                onCancel={() => setNewAgentView('create')}
                            />
                        ) : (
                            <form onSubmit={createAgentInline} className="modal-body">
                                <div className="form-group">
                                    <label className="form-label">Agent name</label>
                                    <input
                                        className="form-input"
                                        type="text"
                                        placeholder="e.g. Researcher"
                                        value={newAgentForm.name}
                                        onChange={(e) => setNewAgentForm((f) => ({ ...f, name: e.target.value }))}
                                        required
                                        autoFocus
                                    />
                                </div>
                                <div className="form-group">
                                    <div className="fallbacks-header">
                                        <label className="form-label">Primary model</label>
                                        <button
                                            type="button"
                                            className="btn-add-fallback"
                                            onClick={async () => {
                                                try {
                                                    const res = await fetch('/api/openclaw/models');
                                                    const data = await res.json().catch(() => ({}));
                                                    if (res.ok) setAvailableToAdd(data.availableToAdd ?? []);
                                                    else setAvailableToAdd([]);
                                                    setNewAgentView('addModel');
                                                } catch {
                                                    setAvailableToAdd([]);
                                                    setNewAgentView('addModel');
                                                }
                                            }}
                                        >
                                            + Add new model
                                        </button>
                                    </div>
                                    <select
                                        className="form-input"
                                        value={newAgentForm.model}
                                        onChange={(e) => {
                                            const nextPrimary = e.target.value;
                                            setNewAgentForm((f) => ({
                                                ...f,
                                                model: nextPrimary,
                                                fallbacks: sanitizeAgentFallbacks(nextPrimary, f.fallbacks),
                                            }));
                                        }}
                                        required
                                    >
                                        {inlineCreatePrimaryOptions.map((m) => (
                                            <option key={m} value={m}>{m}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="form-group form-group-fallbacks">
                                    <div className="fallbacks-header">
                                        <label className="form-label">Fallback models</label>
                                        <button
                                            type="button"
                                            className="btn-add-fallback"
                                            onClick={() => {
                                                const nextOption = getInlineCreateFallbackOptions(-1)[0];
                                                if (!nextOption) return;
                                                setNewAgentForm((f) => ({ ...f, fallbacks: [...f.fallbacks, nextOption] }));
                                            }}
                                            disabled={!canAddInlineFallback}
                                        >
                                            + Add
                                        </button>
                                    </div>
                                    {newAgentForm.fallbacks.length === 0 && (
                                        <div className="fallback-empty">No fallbacks. Global defaults will be used.</div>
                                    )}
                                    {newAgentForm.fallbacks.map((fb, index) => (
                                        <div key={index} className="fallback-row">
                                            <span className="fallback-number">{index + 1}.</span>
                                            <select
                                                className="form-input"
                                                value={fb}
                                                onChange={(e) => {
                                                    const next = [...newAgentForm.fallbacks];
                                                    next[index] = e.target.value;
                                                    setNewAgentForm((f) => ({ ...f, fallbacks: sanitizeAgentFallbacks(f.model, next) }));
                                                }}
                                            >
                                                {getInlineCreateFallbackOptions(index).map((m) => (
                                                    <option key={m} value={m}>{m}</option>
                                                ))}
                                            </select>
                                            <button
                                                type="button"
                                                className="btn-remove-fallback"
                                                onClick={() => setNewAgentForm((f) => ({ ...f, fallbacks: f.fallbacks.filter((_, i) => i !== index) }))}
                                            >
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                                <div className="modal-actions">
                                    <button type="button" className="btn-secondary" onClick={() => setCreateStep('task')}>
                                        Back
                                    </button>
                                    <button type="submit" className="btn-primary" disabled={newAgentSaving || !newAgentForm.name.trim()}>
                                        {newAgentSaving ? 'Creating…' : 'Create agent'}
                                    </button>
                                </div>
                            </form>
                        )}
                    </div>
                </div>
            )}

        </>
    );
}

const KanbanCard = memo(function KanbanCard({
    task,
    agentOptions,
    isSelected,
    isDeleting,
    onToggleSelect,
    onClick,
    onArchive,
    onUpdate,
    onDragStart,
    onStart,
    onStop,
    isStartLoading,
    isStopLoading,
    pausedTaskIds,
    draggable = true,
}: {
    task: Task;
    agentOptions: string[];
    isSelected: boolean;
    isDeleting: boolean;
    onToggleSelect: () => void;
    onClick: () => void;
    onArchive: () => void;
    onUpdate: (payload: TaskUpdatePayload) => void;
    onDragStart: (e: React.DragEvent) => void;
    onStart?: () => void;
    onStop?: () => void | Promise<void>;
    isStartLoading?: boolean;
    isStopLoading?: boolean;
    pausedTaskIds?: Set<string>;
    draggable?: boolean;
}) {
    const dueDateValue = task.dueDate ? task.dueDate.slice(0, 10) : '';
    const hasAgent = !!(task.agent && task.agent.trim());
    const isPaused = pausedTaskIds?.has(task.id) ?? false;
    const isAgentEditable = task.status !== 'Done' && (task.status !== 'Doing' || (pausedTaskIds?.has(task.id) ?? false));
    const handleAgentChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newAgent = e.target.value;
        if (task.status === 'Doing' && task.agent && newAgent !== task.agent && onStop) {
            await onStop();
        }
        onUpdate({ agent: newAgent });
    };
    return (
        <div
            className={`kanban-card ${isSelected ? 'kanban-card-selected' : ''} ${isDeleting ? 'kanban-card-deleting' : ''}`}
            draggable={draggable}
            onDragStart={draggable ? onDragStart : undefined}
        >
            <div className="kanban-card-top">
                <input
                    type="checkbox"
                    className="kanban-card-checkbox"
                    checked={isSelected}
                    onChange={onToggleSelect}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Select ${task.title}`}
                />
                <div className="kanban-card-head" onClick={onClick}>
                    <div className="kanban-card-title-row">
                        <span className="kanban-card-title">{task.title}</span>
                        <span className="kanban-card-source-badge" title={task.source === 'notion' ? 'Synced with Notion' : 'Local task'}>
                            {task.source === 'notion' ? (
                                <img src="/images/notion-favicon.ico" alt="Notion" className="kanban-card-source-badge-icon" width={14} height={14} />
                            ) : (
                                'Local'
                            )}
                        </span>
                        {hasAgent && onStart != null && onStop != null && task.status !== 'Done' && (
                            <div className="kanban-card-task-actions" onClick={(e) => e.stopPropagation()}>
                                {task.status === 'Doing' && (
                                    <button
                                        type="button"
                                        className="kanban-card-action-btn"
                                        onClick={isPaused ? onStart : onStop}
                                        disabled={isStartLoading || isStopLoading}
                                        title={isPaused ? 'Resume agent' : 'Pause agent'}
                                        aria-label={isPaused ? 'Resume agent' : 'Pause agent'}
                                    >
                                        {isPaused ? (isStartLoading ? 'Resuming…' : 'Resume') : (isStopLoading ? 'Pausing…' : 'Pause')}
                                    </button>
                                )}
                                {task.status === 'To Do' && (
                                    <button
                                        type="button"
                                        className="kanban-card-action-btn"
                                        onClick={onStart}
                                        disabled={isStartLoading || isStopLoading}
                                        title="Start task"
                                        aria-label="Start task"
                                    >
                                        {isStartLoading ? 'Starting…' : 'Start'}
                                    </button>
                                )}
                                {task.status === 'Doing' && (
                                    <button
                                        type="button"
                                        className="kanban-card-action-btn"
                                        onClick={onStop}
                                        disabled={isStartLoading || isStopLoading}
                                        title="Stop task"
                                        aria-label="Stop task"
                                    >
                                        {isStopLoading ? 'Stopping…' : 'Stop'}
                                    </button>
                                )}
                            </div>
                        )}
                        <button
                            type="button"
                            className="kanban-card-archive-btn"
                            onClick={(e) => { e.stopPropagation(); onArchive(); }}
                            title="Archive"
                            aria-label="Archive task"
                            disabled={isDeleting}
                        >
                            Archive
                        </button>
                    </div>
                    <div className="kanban-card-fields" onClick={(e) => e.stopPropagation()}>
                        {agentOptions.length > 0 && (
                            <div className="kanban-card-agent-row">
                                <span className="kanban-card-agent-label">Agent:</span>
                                <select
                                    className="kanban-card-agent-select"
                                    value={task.agent ?? ''}
                                    onChange={handleAgentChange}
                                    aria-label="Agent"
                                    disabled={!isAgentEditable}
                                >
                                    {agentOptions.map((name) => (
                                        <option key={name} value={name}>{name}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                        <div className="kanban-card-due-row">
                            <span className="kanban-card-due-label">Due:</span>
                            <div className="date-picker-wrap date-picker-wrap-sm">
                                <svg className="date-picker-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                                    <line x1="16" y1="2" x2="16" y2="6" />
                                    <line x1="8" y1="2" x2="8" y2="6" />
                                    <line x1="3" y1="10" x2="21" y2="10" />
                                </svg>
                                <input
                                    type="date"
                                    className="kanban-card-due-input date-picker-input"
                                    value={dueDateValue}
                                    onChange={(e) => onUpdate({ dueDate: e.target.value || null })}
                                    aria-label="Due date"
                                />
                            </div>
                        </div>
                    </div>
                    {(task.important || task.urgent) && (
                        <div className="kanban-card-flags">
                            {task.important && <span className="kanban-flag kanban-flag-important">Important</span>}
                            {task.urgent && <span className="kanban-flag kanban-flag-urgent">Urgent</span>}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
});

function TaskDetailModal({
    task,
    details,
    isLoading,
    onClose,
    notionUrl,
    onUpdateTask,
    agentOptions,
    onStart,
    onStop,
    isStartLoading,
    isStopLoading,
    isAgentEditable,
    isPaused,
}: {
    task: Task;
    details?: TaskDetails | null;
    isLoading: boolean;
    onClose: () => void;
    notionUrl?: string;
    onUpdateTask: (payload: TaskUpdatePayload) => Promise<void>;
    agentOptions: string[];
    onStart?: () => void;
    onStop?: () => void | Promise<void>;
    isStartLoading?: boolean;
    isStopLoading?: boolean;
    isAgentEditable?: boolean;
    isPaused?: boolean;
}) {
    const contentRef = useRef<HTMLDivElement>(null);
    const [descriptionDraft, setDescriptionDraft] = useState(details?.description ?? '');
    const [savingDescription, setSavingDescription] = useState(false);
    const [sensitivityDialogOpen, setSensitivityDialogOpen] = useState(false);
    const [sensitivityFindingsPending, setSensitivityFindingsPending] = useState<string[]>([]);
    useEffect(() => {
        if (details) setDescriptionDraft(details.description ?? '');
    }, [details?.description, task?.id]);
    useEffect(() => {
        contentRef.current?.scrollTo(0, 0);
    }, [task.id]);

    const handleSaveDescription = async () => {
        const findings = scanForSensitiveContent(descriptionDraft);
        if (findings.length > 0) {
            setSensitivityFindingsPending(findings);
            setSensitivityDialogOpen(true);
            return;
        }
        setSavingDescription(true);
        await onUpdateTask({ description: descriptionDraft });
        setSavingDescription(false);
    };

    const handleSensitivityConfirm = async () => {
        setSensitivityDialogOpen(false);
        setSensitivityFindingsPending([]);
        setSavingDescription(true);
        await onUpdateTask({ description: descriptionDraft });
        setSavingDescription(false);
    };

    const handleSensitivityRevert = () => {
        setDescriptionDraft(details?.description ?? '');
        setSensitivityDialogOpen(false);
        setSensitivityFindingsPending([]);
    };

    return (
        <>
            <div className="task-detail-modal-header">
                <h2 className="modal-title">{task.title}</h2>
                <div className="task-detail-modal-actions">
                    {task.agent && onStart != null && onStop != null && task.status !== 'Done' && (
                        <>
                            {task.status === 'Doing' && (
                                <button
                                    type="button"
                                    className="btn-secondary btn-sm"
                                    onClick={isPaused ? onStart : onStop}
                                    disabled={isStartLoading || isStopLoading}
                                    title={isPaused ? 'Resume agent' : 'Pause agent'}
                                    aria-label={isPaused ? 'Resume agent' : 'Pause agent'}
                                >
                                    {isPaused ? (isStartLoading ? 'Resuming…' : 'Resume') : (isStopLoading ? 'Pausing…' : 'Pause')}
                                </button>
                            )}
                            {task.status === 'To Do' && (
                                <button
                                    type="button"
                                    className="btn-secondary btn-sm"
                                    onClick={onStart}
                                    disabled={isStartLoading || isStopLoading}
                                    title="Start task"
                                    aria-label="Start task"
                                >
                                    {isStartLoading ? 'Starting…' : 'Start'}
                                </button>
                            )}
                            {task.status === 'Doing' && (
                                <button
                                    type="button"
                                    className="btn-secondary btn-sm"
                                    onClick={onStop}
                                    disabled={isStartLoading || isStopLoading}
                                    title="Stop task"
                                    aria-label="Stop task"
                                >
                                    {isStopLoading ? 'Stopping…' : 'Stop'}
                                </button>
                            )}
                        </>
                    )}
                    {notionUrl && (
                        <a
                            href={notionUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-notion-logo"
                            title="Open in Notion"
                            aria-label="Open in Notion"
                        >
                            <img
                                src="/images/notion-favicon.ico"
                                alt=""
                                className="notion-logo-icon"
                                width={20}
                                height={20}
                            />
                        </a>
                    )}
                    <button type="button" className="btn-secondary btn-sm" onClick={onClose}>
                        Close
                    </button>
                </div>
            </div>
            {isLoading ? (
                <p className="task-detail-loading">Loading…</p>
            ) : details ? (
                <div ref={contentRef} className="task-detail-content">
                    <div className="task-detail-editable-row">
                        <div className="form-group task-detail-field">
                            <label className="form-label">Status</label>
                            <select
                                className="form-select"
                                value={task.status}
                                onChange={(e) => onUpdateTask({ status: e.target.value as TaskStatus })}
                            >
                                {COLUMNS.map((c) => (
                                    <option key={c.key} value={c.key}>{c.label}</option>
                                ))}
                            </select>
                        </div>
                        {agentOptions.length > 0 && (
                            <div className="form-group task-detail-field">
                                <label className="form-label">Agent</label>
                                <select
                                    className="form-select"
                                    value={details.agent ?? ''}
                                    onChange={async (e) => {
                                        const newAgent = e.target.value;
                                        if (task.status === 'Doing' && details?.agent && newAgent !== details.agent && onStop) {
                                            await onStop();
                                        }
                                        await onUpdateTask({ agent: newAgent });
                                    }}
                                    disabled={!isAgentEditable}
                                >
                                    {agentOptions.map((name) => (
                                        <option key={name} value={name}>{name}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                        <div className="form-group task-detail-field task-detail-field-due">
                            <label className="form-label">Due date</label>
                            <div className="date-picker-wrap">
                                <svg className="date-picker-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                                    <line x1="16" y1="2" x2="16" y2="6" />
                                    <line x1="8" y1="2" x2="8" y2="6" />
                                    <line x1="3" y1="10" x2="21" y2="10" />
                                </svg>
                                <input
                                    type="date"
                                    className="date-picker-input"
                                    value={details.dueDate ? details.dueDate.slice(0, 10) : ''}
                                    onChange={(e) => onUpdateTask({ dueDate: e.target.value || null })}
                                    aria-label="Due date"
                                />
                            </div>
                        </div>
                    </div>
                    <div className="task-detail-toggles">
                        <label className="task-detail-toggle">
                            <input
                                type="checkbox"
                                checked={details.important ?? false}
                                onChange={async (e) => await onUpdateTask({ important: e.target.checked })}
                            />
                            <span>Important</span>
                        </label>
                        <label className="task-detail-toggle">
                            <input
                                type="checkbox"
                                checked={details.urgent ?? false}
                                onChange={async (e) => await onUpdateTask({ urgent: e.target.checked })}
                            />
                            <span>Urgent</span>
                        </label>
                    </div>
                    <div className="task-detail-recurring-row">
                        <label className="task-detail-toggle">
                            <input
                                type="checkbox"
                                checked={task.recurring ?? false}
                                onChange={(e) => onUpdateTask({ recurring: e.target.checked })}
                                aria-label="Recurring"
                            />
                            <span>Recurring</span>
                        </label>
                        {(task.recurring ?? false) && (
                            <div className="task-detail-recurring-fields">
                                <div className="task-detail-cron-wrap task-detail-cron-wrap-single">
                                    <span className="task-detail-recur-label">Repeat every</span>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        className="form-input task-detail-recur-input-num"
                                        value={String(task.recurInterval ?? 1)}
                                        onChange={(e) => {
                                            const v = e.target.value.replace(/\D/g, '');
                                            const interval = v === '' ? 1 : Math.max(1, Math.min(99, parseInt(v, 10) || 1));
                                            const cron = structuredToCron(task.recurUnit ?? 'Day', interval, task.recurTime ?? '09:00');
                                            onUpdateTask({ recurInterval: interval, cron });
                                        }}
                                        aria-label="Interval"
                                    />
                                    <select
                                        className="form-input task-detail-recur-select"
                                        value={task.recurUnit ?? 'Day'}
                                        onChange={(e) => {
                                            const unit = e.target.value;
                                            const cron = structuredToCron(unit, task.recurInterval ?? 1, task.recurTime ?? '09:00');
                                            onUpdateTask({ recurUnit: unit, cron });
                                        }}
                                    >
                                        {RECUR_UNIT_OPTIONS.map((o) => (
                                            <option key={o.value} value={o.value}>{o.label}</option>
                                        ))}
                                    </select>
                                    <span className="task-detail-recur-label">at</span>
                                    <select
                                        className="form-input task-detail-recur-select task-detail-recur-time"
                                        value={task.recurTime ?? '09:00'}
                                        onChange={(e) => {
                                            const time = e.target.value;
                                            const cron = structuredToCron(task.recurUnit ?? 'Day', task.recurInterval ?? 1, time);
                                            onUpdateTask({ recurTime: time, cron });
                                        }}
                                    >
                                        {RECUR_TIME_OPTIONS.map((t) => (
                                            <option key={t} value={t}>{t}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="task-detail-cron-wrap">
                                    <span className="task-detail-recur-label">End</span>
                                    <select
                                        className="form-input task-detail-recur-select"
                                        value={task.recurEnd ?? 'Never'}
                                        onChange={(e) => onUpdateTask({ recurEnd: e.target.value || null })}
                                    >
                                        {RECUR_END_OPTIONS.map((o) => (
                                            <option key={o.value} value={o.value}>{o.label}</option>
                                        ))}
                                    </select>
                                    {task.recurEnd === 'After' && (
                                        <>
                                            <input
                                                type="text"
                                                inputMode="numeric"
                                                pattern="[0-9]*"
                                                className="form-input task-detail-recur-input-num"
                                                value={task.recurEndCount ?? ''}
                                                onChange={(e) => {
                                                    const v = e.target.value.replace(/\D/g, '');
                                                    onUpdateTask({ recurEndCount: v === '' ? undefined : Math.max(1, Math.min(999, parseInt(v, 10) || 1)) });
                                                }}
                                            />
                                            <span className="task-detail-recur-label">times</span>
                                        </>
                                    )}
                                    {task.recurEnd === 'Until' && (
                                        <input
                                            type="date"
                                            className="form-input"
                                            style={{ minWidth: 120 }}
                                            value={(task.recurEndDate ?? '').slice(0, 10)}
                                            onChange={(e) => onUpdateTask({ recurEndDate: e.target.value || null })}
                                        />
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="task-detail-section">
                        <h3 className="task-detail-section-title">Description</h3>
                        <p className="task-detail-helper">
                            What you want the agent to do. Be specific. Do not include passwords, API keys, or other sensitive information.
                        </p>
                        <textarea
                            className="task-detail-description-input"
                            value={descriptionDraft}
                            onChange={(e) => setDescriptionDraft(e.target.value)}
                            placeholder="e.g. Summarize the meeting notes in the linked doc and add action items to the bottom."
                            rows={4}
                        />
                        <button
                            type="button"
                            className="btn-primary btn-sm"
                            disabled={savingDescription || descriptionDraft === (details.description ?? '')}
                            onClick={handleSaveDescription}
                        >
                            {savingDescription ? 'Saving…' : 'Save description'}
                        </button>
                    </div>
                    <div className="task-detail-section">
                        <h3 className="task-detail-section-title">Agent response</h3>
                        <p className="task-detail-helper">
                            When Notion is connected, this is mapped to the page content. The agent will update this area with progress and results for the task described above.
                        </p>
                        <textarea
                            className="task-detail-agent-response"
                            readOnly
                            value={(details.body ?? '').trim() || ''}
                            placeholder="No content yet. The agent will write progress and results here."
                            rows={6}
                            aria-label="Agent response (read-only)"
                        />
                    </div>
                    <dl className="task-detail-meta">
                        {details.createdAt && (
                            <>
                                <dt>Created</dt>
                                <dd>{formatDate(details.createdAt)}</dd>
                            </>
                        )}
                        {details.lastEditedAt && (
                            <>
                                <dt>Last edited</dt>
                                <dd>{formatDate(details.lastEditedAt)}</dd>
                            </>
                        )}
                    </dl>
                </div>
            ) : (
                <p className="task-detail-loading">Could not load details.</p>
            )}

            {sensitivityDialogOpen && (
                <div
                    className="sensitivity-dialog-backdrop"
                    onClick={handleSensitivityRevert}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="sensitivity-dialog-title"
                >
                    <div
                        className="sensitivity-dialog modal"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 id="sensitivity-dialog-title" className="sensitivity-dialog-title">
                            Possible sensitive information
                        </h3>
                        <p className="sensitivity-dialog-intro">
                            Our scan detected the following. Do not send passwords, API keys, credit cards, or other secrets to the agent.
                        </p>
                        <ul className="sensitivity-dialog-list">
                            {sensitivityFindingsPending.map((f) => (
                                <li key={f}>{f}</li>
                            ))}
                        </ul>
                        <div className="modal-actions">
                            <button type="button" className="btn-secondary" onClick={handleSensitivityRevert}>
                                Revert
                            </button>
                            <button type="button" className="btn-primary" onClick={handleSensitivityConfirm}>
                                Confirm
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
