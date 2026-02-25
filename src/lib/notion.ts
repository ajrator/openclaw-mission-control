/**
 * Notion API client and types for the Tasks database.
 * Credentials: NOTION_API_KEY + NOTION_TASKS_DATABASE_ID from env, or OAuth-stored ~/.openclaw/notion-integration.json.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { revalidateTag } from 'next/cache';
import { createAgent, getOpenClawData } from '@/lib/openclaw';

const NOTION_OAUTH_FILE = 'notion-integration.json';

function getNotionOAuthPath(): string {
    return path.join(os.homedir(), '.openclaw', NOTION_OAUTH_FILE);
}

export interface NotionIntegrationFile {
    accessToken?: string;
    databaseId?: string;
    workspaceId?: string;
    workspaceName?: string;
}

/** Read OAuth-stored integration file. Returns null if missing or invalid. */
export function readNotionIntegrationFile(): NotionIntegrationFile | null {
    const filePath = getNotionOAuthPath();
    if (!fs.existsSync(filePath)) return null;
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw) as NotionIntegrationFile;
        return data && typeof data === 'object' ? data : null;
    } catch {
        return null;
    }
}

/** Write OAuth integration file (merge with existing). Restrict permissions to current user. */
export function writeNotionIntegrationFile(updates: Partial<NotionIntegrationFile>): void {
    const filePath = getNotionOAuthPath();
    const dir = path.dirname(filePath);
    const existing = readNotionIntegrationFile() ?? {};
    const next = { ...existing, ...updates };
    if (!dir) return;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(next, null, 2) + '\n', 'utf-8');
    try {
        fs.chmodSync(filePath, 0o600);
    } catch {
        /* ignore on unsupported platforms */
    }
}

/** Remove OAuth integration file (disconnect). */
export function deleteNotionIntegrationFile(): void {
    const filePath = getNotionOAuthPath();
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

/** Whether OAuth app env is set (CLIENT_ID + CLIENT_SECRET). Used to show "Login with Notion" when Notion not configured. */
export function isNotionOAuthEnvSet(): boolean {
    const id = process.env.NOTION_OAUTH_CLIENT_ID;
    const secret = process.env.NOTION_OAUTH_CLIENT_SECRET;
    return !!(id?.trim() && secret?.trim());
}

export type TaskStatus = 'To Do' | 'Doing' | 'Done';

export interface NotionTask {
    id: string;
    title: string;
    status: TaskStatus;
    agent?: string;
    important?: boolean;
    urgent?: boolean;
    dueDate?: string;
    /** Raw Notion page ID for updates */
    notionPageId: string;
    /** Recurring task with cron schedule (synced to OpenClaw cron) */
    recurring?: boolean;
    cron?: string;
    cronJobId?: string;
    /** Human-friendly recurring schedule (maps to Notion properties) */
    recurUnit?: string | null;   // Day | Week | Month | MonthFirstWeekday | MonthLastWeekday | MonthLastDay | Year
    recurInterval?: number | null; // e.g. 1 = every 1, 2 = every 2
    recurTime?: string | null;   // HH:mm
    recurEnd?: string | null;    // Never | After | Until
    recurEndCount?: number | null;
    recurEndDate?: string | null; // ISO date
}

export interface BooleanPropertySchema {
    key: string; // actual Notion property name
    type: 'checkbox' | 'select';
    /** For select: [option for true, option for false] e.g. ['Yes', 'No'] */
    selectOptions?: [string, string];
}

export interface NotionDatabaseSchema {
    titleKey: string;
    statusKey: string;
    statusType: 'select' | 'status';
    agentKey?: string;
    agentOptions: string[];
    descriptionKey?: string;
    dueDateKey?: string;
    importantProperty?: BooleanPropertySchema;
    urgentProperty?: BooleanPropertySchema;
    /** Recurring task support */
    recurringKey?: string;
    cronKey?: string;
    cronJobIdKey?: string;
    /** Structured recurring (recur unit, interval, time, end) */
    recurUnitKey?: string;
    recurUnitType?: 'rich_text' | 'select';
    recurIntervalKey?: string;
    recurTimeKey?: string;
    recurEndKey?: string;
    recurEndCountKey?: string;
    recurEndDateKey?: string;
}

export interface NotionPageContent {
    description?: string;
    body: string;
}

export interface TaskDetails extends NotionPageContent {
    title: string;
    status: TaskStatus;
    agent?: string;
    important?: boolean;
    urgent?: boolean;
    dueDate?: string;
    createdAt?: string;
    lastEditedAt?: string;
}

export type NotionTaskSchemaFieldHealth = {
    key: string;
    required: boolean;
    status: 'present' | 'missing' | 'incompatible';
    foundKey?: string;
    foundType?: string;
    expected: string[];
    note?: string;
};

export interface NotionTaskSchemaHealth {
    ok: boolean;
    summary: { present: number; missing: number; incompatible: number };
    fields: NotionTaskSchemaFieldHealth[];
}

export interface TaskUpdatePayload {
    status?: TaskStatus;
    agent?: string;
    important?: boolean;
    urgent?: boolean;
    dueDate?: string | null;
    description?: string;
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

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min
const TASKS_CACHE_TTL_MS = 60 * 1000; // 1 min
const TASK_SCHEMA_ENSURE_TTL_MS = 5 * 60 * 1000; // 5 min
let schemaCache: { data: NotionDatabaseSchema; at: number } | null = null;
let tasksCache: { data: NotionTask[]; at: number } | null = null;
let schemaCachePromise: Promise<NotionDatabaseSchema> | null = null;
let ensureTaskPropsAt = 0;
let ensureTaskPropsPromise: Promise<void> | null = null;

/** Call after any change that affects the Notion Tasks database schema (e.g. adding an Agent select option). */
export function invalidateSchemaCache(): void {
    schemaCache = null;
    schemaCachePromise = null;
    ensureTaskPropsAt = 0;
}

/** Canonical recurring property names (create if missing). Also match common variants when reading. */
const RECUR_UNIT_NAMES = ['Recur Unit', 'Recur unit', 'recur unit'];
const RECUR_INTERVAL_NAMES = ['Recur Interval', 'Recur interval', 'recur interval'];
const RECUR_TIME_NAMES = ['Recur Time', 'Recur time', 'recur time'];
const RECUR_END_NAMES = ['Recur End', 'Recur end', 'recur end'];
const RECUR_END_COUNT_NAMES = ['Recur End Count', 'Recur end count', 'recur end count'];
const RECUR_END_DATE_NAMES = ['Recur End Date', 'Recur end date', 'recur end date'];

function normalizeRecurUnitValue(value: string | undefined | null): string | undefined {
    const raw = (value ?? '').trim();
    if (!raw) return undefined;
    const compact = raw.replace(/\s+/g, '').toLowerCase();

    const aliases: Record<string, string> = {
        day: 'Day',
        daily: 'Day',
        everyday: 'Day',

        week: 'Week',
        weekly: 'Week',
        everyweek: 'Week',

        month: 'Month',
        monthly: 'Month',
        everymonth: 'Month',

        monthfirstweekday: 'MonthFirstWeekday',
        monthsonthefirstweekday: 'MonthFirstWeekday',
        monthsonfirstweekday: 'MonthFirstWeekday',
        firstweekday: 'MonthFirstWeekday',

        monthlastweekday: 'MonthLastWeekday',
        monthsonthelastweekday: 'MonthLastWeekday',
        monthsonlastweekday: 'MonthLastWeekday',
        lastweekday: 'MonthLastWeekday',

        monthlastday: 'MonthLastDay',
        monthsonthelastday: 'MonthLastDay',
        monthsonlastday: 'MonthLastDay',
        lastday: 'MonthLastDay',

        year: 'Year',
        yearly: 'Year',
        annual: 'Year',
        annually: 'Year',
        everyyear: 'Year',
    };

    return aliases[compact] ?? raw;
}

function toNotionRecurUnitValue(value: string | undefined | null): string | undefined {
    const normalized = normalizeRecurUnitValue(value);
    if (!normalized) return undefined;
    const out: Record<string, string> = {
        Day: 'Day',
        Week: 'Week',
        Month: 'Month',
        MonthFirstWeekday: 'Month(s) on the First Weekday',
        MonthLastWeekday: 'Month(s) on the Last Weekday',
        MonthLastDay: 'Month(s) on the Last Day',
        Year: 'Year',
    };
    return out[normalized] ?? normalized;
}

function findPropKey(props: Record<string, { type?: string }>, names: string[]): string | undefined {
    for (const name of names) {
        if (props[name]?.type) return name;
    }
    return undefined;
}

/** Ensure the Tasks database has Recurring, Cron, Cron Job ID, and structured recur properties. Idempotent. */
export async function ensureRecurringProperties(): Promise<void> {
    try {
        const { apiKey, databaseId } = getConfig();
        const res = await fetch(`${NOTION_API}/databases/${databaseId}`, {
            headers: notionHeaders(apiKey),
        });
        if (!res.ok) return;
        const db = (await res.json()) as { properties?: Record<string, { type?: string }> };
        const props = db.properties ?? {};
        const patch: Record<string, unknown> = {};
        if (!props['Recurring']) patch['Recurring'] = { type: 'checkbox' };
        if (!props['Cron']) patch['Cron'] = { type: 'rich_text' };
        if (!props['Cron Job ID']) patch['Cron Job ID'] = { type: 'rich_text' };
        if (!findPropKey(props, RECUR_UNIT_NAMES)) patch['Recur Unit'] = { type: 'rich_text' };
        if (!findPropKey(props, RECUR_INTERVAL_NAMES)) patch['Recur Interval'] = { type: 'number' };
        if (!findPropKey(props, RECUR_TIME_NAMES)) patch['Recur Time'] = { type: 'rich_text' };
        if (!findPropKey(props, RECUR_END_NAMES)) patch['Recur End'] = { type: 'rich_text' };
        if (!findPropKey(props, RECUR_END_COUNT_NAMES)) patch['Recur End Count'] = { type: 'number' };
        if (!findPropKey(props, RECUR_END_DATE_NAMES)) patch['Recur End Date'] = { type: 'date' };
        if (Object.keys(patch).length === 0) return;
        const patchRes = await fetch(`${NOTION_API}/databases/${databaseId}`, {
            method: 'PATCH',
            headers: notionHeaders(apiKey),
            body: JSON.stringify({ properties: patch }),
        });
        if (!patchRes.ok) return;
        invalidateSchemaCache();
    } catch {
        // Notion not configured or permission error; log and continue
    }
}

/** Ensure core task properties exist (Agent/Status/Description/Due/Important/Urgent) plus recurring properties. */
export async function ensureTaskDatabaseProperties(): Promise<void> {
    if (Date.now() - ensureTaskPropsAt < TASK_SCHEMA_ENSURE_TTL_MS) return;
    if (ensureTaskPropsPromise) return ensureTaskPropsPromise;

    ensureTaskPropsPromise = (async () => {
        try {
            const { apiKey, databaseId } = getConfig();
            const res = await fetch(`${NOTION_API}/databases/${databaseId}`, {
                headers: notionHeaders(apiKey),
            });
            if (!res.ok) return;
            const db = (await res.json()) as { properties?: Record<string, { type?: string; select?: { options?: Array<{ name?: string }> } }> };
            const props = db.properties ?? {};
            const patch: Record<string, unknown> = {};

            const hasStatus = Object.entries(props).some(([key, def]) =>
                (key === 'Status' || key === 'status') && (def?.type === 'status' || def?.type === 'select')
            );
            const hasAgentSelect = Object.entries(props).some(([key, def]) =>
                key.trim().toLowerCase() === 'agent' && def?.type === 'select'
            );
            const hasDescription = Object.entries(props).some(([key, def]) =>
                key.trim().toLowerCase() === 'description' && def?.type === 'rich_text'
            );
            const hasDueDate = Object.entries(props).some(([key, def]) => {
                const norm = key.replace(/\s*\?*\s*$/, '').toLowerCase();
                return (norm === 'due' || norm === 'due date') && def?.type === 'date';
            });
            const hasImportant = Object.entries(props).some(([key, def]) =>
                key.replace(/\s*\?*\s*$/, '').toLowerCase() === 'important' &&
                (def?.type === 'checkbox' || def?.type === 'select')
            );
            const hasUrgent = Object.entries(props).some(([key, def]) =>
                key.replace(/\s*\?*\s*$/, '').toLowerCase() === 'urgent' &&
                (def?.type === 'checkbox' || def?.type === 'select')
            );

            if (!hasStatus) {
                patch['Status'] = {
                    select: {
                        options: [{ name: 'To Do' }, { name: 'Doing' }, { name: 'Done' }],
                    },
                };
            }
            if (!hasAgentSelect) {
                const openclawAgents = getOpenClawData().agents
                    .map((a) => (a.name || a.id || '').trim())
                    .filter(Boolean);
                const uniqueAgents = [...new Set(openclawAgents)];
                patch['Agent'] = {
                    select: {
                        options: uniqueAgents.map((name) => ({ name })),
                    },
                };
            }
            if (!hasDescription) patch['Description'] = { type: 'rich_text' };
            if (!hasDueDate) patch['Due date'] = { type: 'date' };
            if (!hasImportant) patch['Important'] = { type: 'checkbox' };
            if (!hasUrgent) patch['Urgent'] = { type: 'checkbox' };
            if (!props['Recurring']) patch['Recurring'] = { type: 'checkbox' };
            if (!props['Cron']) patch['Cron'] = { type: 'rich_text' };
            if (!props['Cron Job ID']) patch['Cron Job ID'] = { type: 'rich_text' };
            if (!findPropKey(props, RECUR_UNIT_NAMES)) patch['Recur Unit'] = { type: 'rich_text' };
            if (!findPropKey(props, RECUR_INTERVAL_NAMES)) patch['Recur Interval'] = { type: 'number' };
            if (!findPropKey(props, RECUR_TIME_NAMES)) patch['Recur Time'] = { type: 'rich_text' };
            if (!findPropKey(props, RECUR_END_NAMES)) patch['Recur End'] = { type: 'rich_text' };
            if (!findPropKey(props, RECUR_END_COUNT_NAMES)) patch['Recur End Count'] = { type: 'number' };
            if (!findPropKey(props, RECUR_END_DATE_NAMES)) patch['Recur End Date'] = { type: 'date' };

            if (Object.keys(patch).length === 0) return;
            const patchRes = await fetch(`${NOTION_API}/databases/${databaseId}`, {
                method: 'PATCH',
                headers: notionHeaders(apiKey),
                body: JSON.stringify({ properties: patch }),
            });
            if (!patchRes.ok) return;
            invalidateSchemaCache();
        } catch {
            // Notion not configured or permission error; continue in local-only mode.
        } finally {
            ensureTaskPropsAt = Date.now();
            ensureTaskPropsPromise = null;
        }
    })();

    return ensureTaskPropsPromise;
}

export async function getTaskDatabaseSchemaHealth(): Promise<NotionTaskSchemaHealth> {
    const { apiKey, databaseId } = getConfig();
    const res = await fetch(`${NOTION_API}/databases/${databaseId}`, {
        headers: notionHeaders(apiKey),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Notion API error ${res.status}: ${err}`);
    }
    const db = (await res.json()) as {
        properties?: Record<string, { type?: string }>;
    };
    const props = db.properties ?? {};
    const entries = Object.entries(props);

    const findByName = (names: string[]) =>
        entries.find(([k]) => names.some((n) => k.trim().toLowerCase() === n.trim().toLowerCase()));
    const findByPredicate = (fn: (key: string, type?: string) => boolean) =>
        entries.find(([k, def]) => fn(k, def?.type));

    const checks: Array<{ key: string; required: boolean; expected: string[]; finder: () => [string, { type?: string }] | undefined; note?: string }> = [
        {
            key: 'Title',
            required: true,
            expected: ['title'],
            finder: () => findByPredicate((_k, type) => type === 'title'),
            note: 'Database must have a title property (any name).',
        },
        {
            key: 'Status',
            required: true,
            expected: ['status', 'select'],
            finder: () => findByName(['Status', 'status']),
        },
        {
            key: 'Agent',
            required: true,
            expected: ['select'],
            finder: () => findByName(['Agent']),
        },
        {
            key: 'Description',
            required: true,
            expected: ['rich_text'],
            finder: () => findByName(['Description', 'description']),
        },
        {
            key: 'Due date',
            required: true,
            expected: ['date'],
            finder: () => findByPredicate((key) => {
                const norm = key.replace(/\s*\?*\s*$/, '').toLowerCase();
                return norm === 'due' || norm === 'due date';
            }),
        },
        {
            key: 'Important',
            required: false,
            expected: ['checkbox', 'select'],
            finder: () => findByPredicate((key) => key.replace(/\s*\?*\s*$/, '').toLowerCase() === 'important'),
        },
        {
            key: 'Urgent',
            required: false,
            expected: ['checkbox', 'select'],
            finder: () => findByPredicate((key) => key.replace(/\s*\?*\s*$/, '').toLowerCase() === 'urgent'),
        },
        {
            key: 'Recurring',
            required: false,
            expected: ['checkbox'],
            finder: () => findByName(['Recurring']),
        },
        {
            key: 'Cron',
            required: false,
            expected: ['rich_text'],
            finder: () => findByName(['Cron']),
        },
        {
            key: 'Cron Job ID',
            required: false,
            expected: ['rich_text'],
            finder: () => findByName(['Cron Job ID', 'CronJobId']),
        },
        {
            key: 'Recur Unit',
            required: false,
            expected: ['rich_text', 'select'],
            finder: () => findByName(RECUR_UNIT_NAMES),
        },
        {
            key: 'Recur Interval',
            required: false,
            expected: ['number'],
            finder: () => findByName(RECUR_INTERVAL_NAMES),
        },
        {
            key: 'Recur Time',
            required: false,
            expected: ['rich_text'],
            finder: () => findByName(RECUR_TIME_NAMES),
        },
        {
            key: 'Recur End',
            required: false,
            expected: ['rich_text'],
            finder: () => findByName(RECUR_END_NAMES),
        },
        {
            key: 'Recur End Count',
            required: false,
            expected: ['number'],
            finder: () => findByName(RECUR_END_COUNT_NAMES),
        },
        {
            key: 'Recur End Date',
            required: false,
            expected: ['date'],
            finder: () => findByName(RECUR_END_DATE_NAMES),
        },
    ];

    const fields: NotionTaskSchemaFieldHealth[] = checks.map((c) => {
        const found = c.finder();
        if (!found) {
            return { key: c.key, required: c.required, status: 'missing', expected: c.expected, note: c.note };
        }
        const [foundKey, def] = found;
        const foundType = def?.type ?? 'unknown';
        const ok = c.expected.includes(foundType);
        return {
            key: c.key,
            required: c.required,
            status: ok ? 'present' : 'incompatible',
            foundKey,
            foundType,
            expected: c.expected,
            note: c.note,
        };
    });

    const summary = {
        present: fields.filter((f) => f.status === 'present').length,
        missing: fields.filter((f) => f.status === 'missing').length,
        incompatible: fields.filter((f) => f.status === 'incompatible').length,
    };

    return {
        ok: fields.every((f) => !f.required || f.status === 'present'),
        summary,
        fields,
    };
}

/** Call after any change that affects the task list (status update, create, archive). */
export function invalidateTasksCache(): void {
    tasksCache = null;
    revalidateTag('notion-tasks', 'max');
}

/** Normalize Notion ID to 36-char UUID format if it's 32 chars without hyphens */
function normalizeNotionId(id: string): string {
    const clean = id.replace(/-/g, '');
    if (clean.length === 32) {
        return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}-${clean.slice(16, 20)}-${clean.slice(20)}`;
    }
    return id;
}

/** Whether Notion integration is configured (env or OAuth file with accessToken + databaseId). */
export function isNotionConfigured(): boolean {
    const apiKey = process.env.NOTION_API_KEY;
    const databaseId = process.env.NOTION_TASKS_DATABASE_ID;
    if (apiKey?.trim() && databaseId?.trim()) return true;
    const oauth = readNotionIntegrationFile();
    return !!(oauth?.accessToken?.trim() && oauth?.databaseId?.trim());
}

/** True when credentials come from OAuth file (so Disconnect will have an effect). */
export function isNotionConfiguredViaOAuth(): boolean {
    if (process.env.NOTION_API_KEY?.trim() && process.env.NOTION_TASKS_DATABASE_ID?.trim()) return false;
    const oauth = readNotionIntegrationFile();
    return !!(oauth?.accessToken?.trim() && oauth?.databaseId?.trim());
}

function getConfig() {
    const apiKey = process.env.NOTION_API_KEY;
    const databaseId = process.env.NOTION_TASKS_DATABASE_ID;
    if (apiKey?.trim() && databaseId?.trim()) {
        return { apiKey, databaseId: normalizeNotionId(databaseId) };
    }
    const oauth = readNotionIntegrationFile();
    if (oauth?.accessToken?.trim() && oauth?.databaseId?.trim()) {
        return { apiKey: oauth.accessToken, databaseId: normalizeNotionId(oauth.databaseId) };
    }
    throw new Error('Missing NOTION_API_KEY or NOTION_TASKS_DATABASE_ID in environment, or complete Notion OAuth and select a database');
}

function notionHeaders(apiKey: string): Record<string, string> {
    return {
        Authorization: `Bearer ${apiKey}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
    };
}

/**
 * Filter: tasks where Agent property is not empty.
 * Your Notion database uses Agent as a "select" property.
 */
function agentNotEmptyFilter(agentProperty = 'Agent') {
    return {
        property: agentProperty,
        select: { is_not_empty: true },
    };
}

function extractTitle(properties: Record<string, unknown>): string {
    const titleProp = properties?.title ?? properties?.Name ?? properties?.Task;
    if (!titleProp || typeof titleProp !== 'object') return 'Untitled';
    const prop = titleProp as { title?: Array<{ plain_text?: string }> };
    const list = prop.title;
    if (!Array.isArray(list) || list.length === 0) return 'Untitled';
    return list.map((t) => t.plain_text ?? '').join('') || 'Untitled';
}

function extractStatus(properties: Record<string, unknown>): TaskStatus {
    const statusProp = properties?.Status ?? properties?.status;
    if (!statusProp || typeof statusProp !== 'object') return 'To Do';
    const prop = statusProp as { select?: { name?: string }; status?: { name?: string } };
    const name = (prop.select?.name ?? prop.status?.name ?? '').trim();
    if (name === 'Doing' || name === 'Done') return name;
    return 'To Do';
}

function extractAgent(properties: Record<string, unknown>): string | undefined {
    const agentProp = properties?.Agent;
    if (!agentProp || typeof agentProp !== 'object') return undefined;
    const prop = agentProp as {
        rich_text?: Array<{ plain_text?: string }>;
        select?: { name?: string };
        multi_select?: Array<{ name?: string }>;
    };
    if (Array.isArray(prop.rich_text) && prop.rich_text.length > 0) {
        return prop.rich_text.map((t) => t.plain_text ?? '').join('').trim() || undefined;
    }
    if (prop.select?.name) return prop.select.name.trim();
    if (Array.isArray(prop.multi_select) && prop.multi_select.length > 0) {
        return prop.multi_select.map((m) => m.name ?? '').join(', ').trim() || undefined;
    }
    return undefined;
}

function extractCheckboxByKey(properties: Record<string, unknown>, key: string): boolean {
    const prop = properties?.[key];
    if (!prop || typeof prop !== 'object') return false;
    const p = prop as { checkbox?: boolean };
    return typeof p.checkbox === 'boolean' && p.checkbox;
}

function extractRichTextByKey(properties: Record<string, unknown>, key: string): string | undefined {
    const prop = properties?.[key];
    if (!prop || typeof prop !== 'object') return undefined;
    const p = prop as { rich_text?: Array<{ plain_text?: string }> };
    const text = p.rich_text?.map((t) => t.plain_text ?? '').join('').trim();
    return text || undefined;
}

function extractTextOrSelectByKey(properties: Record<string, unknown>, key: string): string | undefined {
    const prop = properties?.[key];
    if (!prop || typeof prop !== 'object') return undefined;
    const p = prop as { rich_text?: Array<{ plain_text?: string }>; select?: { name?: string } };
    if (p.select?.name && p.select.name.trim()) return p.select.name.trim();
    const text = p.rich_text?.map((t) => t.plain_text ?? '').join('').trim();
    return text || undefined;
}

function extractNumberByKey(properties: Record<string, unknown>, key: string): number | undefined {
    const prop = properties?.[key];
    if (!prop || typeof prop !== 'object') return undefined;
    const p = prop as { number?: number };
    return typeof p.number === 'number' ? p.number : undefined;
}

function extractDateByKey(properties: Record<string, unknown>, key: string): string | undefined {
    const prop = properties?.[key];
    if (!prop || typeof prop !== 'object') return undefined;
    const p = prop as { date?: { start?: string } };
    return p.date?.start ?? undefined;
}

/** Try keys like "Important", "Important?", "Urgent", "Urgent?" */
function extractCheckbox(properties: Record<string, unknown>, baseKey: string): boolean {
    const keys = [baseKey, `${baseKey}?`, `${baseKey} `];
    for (const key of keys) {
        const prop = properties?.[key];
        if (!prop || typeof prop !== 'object') continue;
        const p = prop as { checkbox?: boolean; select?: { name?: string } };
        if (typeof p.checkbox === 'boolean') return p.checkbox;
        if (p.select?.name) {
            const n = (p.select.name as string).toLowerCase();
            return n === 'yes' || n === 'true' || n === '1' || n === 'important' || n === 'urgent';
        }
    }
    return false;
}

export async function queryTasksFromNotion(options?: { forceRefresh?: boolean }): Promise<NotionTask[]> {
    const useCache =
        !options?.forceRefresh &&
        tasksCache &&
        Date.now() - tasksCache.at < TASKS_CACHE_TTL_MS;
    if (useCache) {
        return tasksCache!.data;
    }

    await ensureTaskDatabaseProperties();
    const { apiKey, databaseId } = getConfig();
    const schema = await getDatabaseSchema(options);

    const tasks: NotionTask[] = [];
    let cursor: string | undefined;

    do {
        const body: Record<string, unknown> = {
            ...(schema.agentKey ? { filter: agentNotEmptyFilter(schema.agentKey) } : {}),
            page_size: 100,
        };
        if (cursor) body.start_cursor = cursor;

        const res = await fetch(`${NOTION_API}/databases/${databaseId}/query`, {
            method: 'POST',
            headers: notionHeaders(apiKey),
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Notion API error ${res.status}: ${err}`);
        }

        const data = (await res.json()) as {
            results?: Array<{
                id: string;
                properties?: Record<string, unknown>;
            }>;
            next_cursor?: string | null;
            has_more?: boolean;
        };

        const results = data.results ?? [];
        for (const page of results) {
            const props = page.properties ?? {};
            const task: NotionTask = {
                id: page.id,
                notionPageId: page.id,
                title: extractTitle(props),
                status: extractStatus(props),
                agent: extractAgent(props),
                important: extractCheckbox(props, 'Important'),
                urgent: extractCheckbox(props, 'Urgent'),
                dueDate: extractDueDate(props),
            };
            if (schema.recurringKey) task.recurring = extractCheckboxByKey(props, schema.recurringKey);
            if (schema.cronKey) task.cron = extractRichTextByKey(props, schema.cronKey);
            if (schema.cronJobIdKey) task.cronJobId = extractRichTextByKey(props, schema.cronJobIdKey);
            if (schema.recurUnitKey) task.recurUnit = normalizeRecurUnitValue(extractTextOrSelectByKey(props, schema.recurUnitKey));
            if (schema.recurIntervalKey) task.recurInterval = extractNumberByKey(props, schema.recurIntervalKey);
            if (schema.recurTimeKey) task.recurTime = extractRichTextByKey(props, schema.recurTimeKey) ?? undefined;
            if (schema.recurEndKey) task.recurEnd = extractRichTextByKey(props, schema.recurEndKey) ?? undefined;
            if (schema.recurEndCountKey) task.recurEndCount = extractNumberByKey(props, schema.recurEndCountKey);
            if (schema.recurEndDateKey) task.recurEndDate = extractDateByKey(props, schema.recurEndDateKey) ?? undefined;
            tasks.push(task);
        }

        cursor = data.next_cursor ?? undefined;
        if (!data.has_more) break;
    } while (cursor);

    tasksCache = { data: tasks, at: Date.now() };
    return tasks;
}

/**
 * Fetch database schema for property names and Agent select options.
 * Cache (5 min TTL) is bypassed when options.forceRefresh is true.
 * Cache is invalidated on: addAgentSelectOption (after adding an agent to Notion).
 * Use GET /api/notion/options?fresh=1 when the client needs fresh options (e.g. after creating an agent).
 */
export async function getDatabaseSchema(options?: { forceRefresh?: boolean }): Promise<NotionDatabaseSchema> {
    const useCache = !options?.forceRefresh && schemaCache && Date.now() - schemaCache.at < SCHEMA_CACHE_TTL_MS;
    if (useCache) {
        return schemaCache!.data;
    }
    if (!options?.forceRefresh && schemaCachePromise) {
        return schemaCachePromise;
    }
    schemaCachePromise = (async () => {
    const { apiKey, databaseId } = getConfig();
    const res = await fetch(`${NOTION_API}/databases/${databaseId}`, {
        headers: notionHeaders(apiKey),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Notion API error ${res.status}: ${err}`);
    }
    const db = (await res.json()) as {
        properties?: Record<
            string,
            {
                type?: string;
                title?: unknown;
                select?: { options?: Array<{ name?: string }> };
                status?: { options?: Array<{ name?: string }> };
                checkbox?: unknown;
                rich_text?: unknown;
                date?: unknown;
            }
            >;
    };
    const props = db.properties ?? {};
    let titleKey = 'Name';
    let statusKey = 'Status';
    let statusType: 'select' | 'status' = 'status';
    let agentKey: string | undefined;
    const agentOptions: string[] = [];
    let descriptionKey: string | undefined;
    let dueDateKey: string | undefined;
    let importantProperty: BooleanPropertySchema | undefined;
    let urgentProperty: BooleanPropertySchema | undefined;
    let recurringKey: string | undefined;
    let cronKey: string | undefined;
    let cronJobIdKey: string | undefined;

    for (const [key, def] of Object.entries(props)) {
        if (!def || typeof def !== 'object') continue;
        if (def.type === 'title') {
            titleKey = key;
            continue;
        }
        if (def.type === 'status' && def.status?.options && (key === 'Status' || key === 'status')) {
            statusKey = key;
            statusType = 'status';
            continue;
        }
        if (def.type === 'select' && (key === 'Status' || key === 'status')) {
            statusKey = key;
            statusType = 'select';
            continue;
        }
        if (key.trim().toLowerCase() === 'agent' && def.select?.options) {
            agentKey = key;
            for (const o of def.select.options) {
                if (o.name) agentOptions.push(o.name);
            }
        }
        if ((key === 'Description' || key === 'description') && def.type === 'rich_text') {
            descriptionKey = key;
        }
        const keyNorm = key.replace(/\s*\?*\s*$/, '').toLowerCase();
        if ((keyNorm === 'due' || keyNorm === 'due date') && def.type === 'date') {
            dueDateKey = key;
        }
        if (keyNorm === 'important') {
            if (def.type === 'checkbox') importantProperty = { key, type: 'checkbox' };
            else if (def.type === 'select' && def.select?.options?.length) {
                const names = def.select.options.map((o) => o.name ?? '').filter(Boolean);
                importantProperty = {
                    key,
                    type: 'select',
                    selectOptions: names.length >= 2 ? [names[0], names[1]] : names.length === 1 ? [names[0], ''] : undefined,
                };
            }
        }
        if (keyNorm === 'urgent') {
            if (def.type === 'checkbox') urgentProperty = { key, type: 'checkbox' };
            else if (def.type === 'select' && def.select?.options?.length) {
                const names = def.select.options.map((o) => o.name ?? '').filter(Boolean);
                urgentProperty = {
                    key,
                    type: 'select',
                    selectOptions: names.length >= 2 ? [names[0], names[1]] : names.length === 1 ? [names[0], ''] : undefined,
                };
            }
        }
        if (key === 'Recurring' && def.type === 'checkbox') recurringKey = key;
        if (key === 'Cron' && def.type === 'rich_text') cronKey = key;
        if ((key === 'Cron Job ID' || key === 'CronJobId') && def.type === 'rich_text') cronJobIdKey = key;
    }
    const recurUnitKey = RECUR_UNIT_NAMES.find((n) => props[n]?.type);
    const recurUnitType =
        recurUnitKey && (props[recurUnitKey]?.type === 'select' || props[recurUnitKey]?.type === 'rich_text')
            ? (props[recurUnitKey]?.type as 'rich_text' | 'select')
            : undefined;
    const recurIntervalKey = RECUR_INTERVAL_NAMES.find((n) => props[n]?.type);
    const recurTimeKey = RECUR_TIME_NAMES.find((n) => props[n]?.type);
    const recurEndKey = RECUR_END_NAMES.find((n) => props[n]?.type);
    const recurEndCountKey = RECUR_END_COUNT_NAMES.find((n) => props[n]?.type);
    const recurEndDateKey = RECUR_END_DATE_NAMES.find((n) => props[n]?.type);
    const result: NotionDatabaseSchema = {
        titleKey,
        statusKey,
        statusType,
        agentKey,
        agentOptions,
        descriptionKey,
        dueDateKey,
        importantProperty,
        urgentProperty,
        recurringKey,
        cronKey,
        cronJobIdKey,
        recurUnitKey,
        recurUnitType,
        recurIntervalKey,
        recurTimeKey,
        recurEndKey,
        recurEndCountKey,
        recurEndDateKey,
    };

    try {
        syncAgentsFromNotionOptions(result.agentOptions);
    } catch (e) {
        console.warn('Sync agents from Notion options:', (e as Error).message);
    }

    schemaCache = { data: result, at: Date.now() };
    return result;
    })();

    try {
        return await schemaCachePromise;
    } finally {
        schemaCachePromise = null;
    }
}

/** Create OpenClaw agents for any Notion Agent select option that does not exist yet (default model, no fallbacks). */
function syncAgentsFromNotionOptions(agentOptions: string[]): void {
    if (!agentOptions?.length) return;
    const { agents, availableModels, config } = getOpenClawData();
    const configTyped = config as { agents?: { defaults?: { model?: { primary?: string } } } };
    const defaultModel =
        availableModels[0] ?? configTyped.agents?.defaults?.model?.primary ?? '';
    if (!defaultModel) return;

    const existingIds = new Set(agents.map((a) => a.id));
    const existingNames = new Set(agents.map((a) => a.name.trim().toLowerCase()));

    for (const name of agentOptions) {
        const trimmed = name.trim();
        if (!trimmed) continue;
        const id = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        if (existingIds.has(id) || existingNames.has(trimmed.toLowerCase())) continue;
        createAgent(trimmed, defaultModel, []);
        existingIds.add(id);
        existingNames.add(trimmed.toLowerCase());
    }
}

/** Add a new option to the Agent select property in the Tasks database. Idempotent: no-op if name already exists. */
export async function addAgentSelectOption(agentName: string): Promise<void> {
    if (!agentName?.trim()) return;
    const { apiKey, databaseId } = getConfig();
    const res = await fetch(`${NOTION_API}/databases/${databaseId}`, {
        headers: notionHeaders(apiKey),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Notion API error ${res.status}: ${err}`);
    }
    const db = (await res.json()) as {
        properties?: Record<
            string,
            {
                type?: string;
                select?: { options?: Array<{ id?: string; name?: string; color?: string }> };
            }
        >;
    };
    const agentKey = Object.keys(db.properties ?? {}).find((k) => k.trim().toLowerCase() === 'agent');
    const agentProp = agentKey ? db.properties?.[agentKey] : undefined;
    if (!agentProp || agentProp.type !== 'select') {
        throw new Error('Tasks database has no Agent select property');
    }
    const existing = agentProp.select?.options ?? [];
    const names = new Set(existing.map((o) => o.name?.trim()).filter(Boolean));
    if (names.has(agentName.trim())) return; // already exists
    const options: Array<{ id?: string; name: string; color?: string }> = existing.map((o) => ({
        ...(o.id && { id: o.id }),
        name: o.name ?? '',
        ...(o.color && { color: o.color }),
    }));
    options.push({ name: agentName.trim() });
    const patchRes = await fetch(`${NOTION_API}/databases/${databaseId}`, {
        method: 'PATCH',
        headers: notionHeaders(apiKey),
        body: JSON.stringify({
            properties: {
                [agentKey!]: {
                    select: { options },
                },
            },
        }),
    });
    if (!patchRes.ok) {
        const err = await patchRes.text();
        throw new Error(`Notion API PATCH error ${patchRes.status}: ${err}`);
    }
    invalidateSchemaCache();
}

/** Remove an option from the Agent select property in the Tasks database. No-op if option not found. */
export async function removeAgentSelectOption(agentName: string): Promise<void> {
    if (!agentName?.trim()) return;
    const { apiKey, databaseId } = getConfig();
    const res = await fetch(`${NOTION_API}/databases/${databaseId}`, {
        headers: notionHeaders(apiKey),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Notion API error ${res.status}: ${err}`);
    }
    const db = (await res.json()) as {
        properties?: Record<
            string,
            {
                type?: string;
                select?: { options?: Array<{ id?: string; name?: string; color?: string }> };
            }
        >;
    };
    const agentKey = Object.keys(db.properties ?? {}).find((k) => k.trim().toLowerCase() === 'agent');
    const agentProp = agentKey ? db.properties?.[agentKey] : undefined;
    if (!agentProp || agentProp.type !== 'select') {
        throw new Error('Tasks database has no Agent select property');
    }
    const existing = agentProp.select?.options ?? [];
    const want = agentName.trim();
    const options = existing
        .map((o) => ({
            ...(o.id && { id: o.id }),
            name: o.name ?? '',
            ...(o.color && { color: o.color }),
        }))
        .filter((o) => o.name.trim() !== want);
    if (options.length === existing.length) return; // option not present
    const patchRes = await fetch(`${NOTION_API}/databases/${databaseId}`, {
        method: 'PATCH',
        headers: notionHeaders(apiKey),
        body: JSON.stringify({
            properties: {
                [agentKey!]: {
                    select: { options },
                },
            },
        }),
    });
    if (!patchRes.ok) {
        const err = await patchRes.text();
        throw new Error(`Notion API PATCH error ${patchRes.status}: ${err}`);
    }
    invalidateSchemaCache();
}

/** Update task properties in Notion. All changes sync to Notion. */
export async function updateTaskProperties(
    pageId: string,
    payload: TaskUpdatePayload
): Promise<void> {
    const { apiKey } = getConfig();
    const normalizedId = normalizeNotionId(pageId);
    const properties: Record<string, unknown> = {};
    const hasAny =
        payload.status !== undefined ||
        payload.agent !== undefined ||
        payload.important !== undefined ||
        payload.urgent !== undefined ||
        payload.dueDate !== undefined ||
        payload.description !== undefined ||
        payload.recurring !== undefined ||
        payload.cron !== undefined ||
        payload.cronJobId !== undefined ||
        payload.recurUnit !== undefined ||
        payload.recurInterval !== undefined ||
        payload.recurTime !== undefined ||
        payload.recurEnd !== undefined ||
        payload.recurEndCount !== undefined ||
        payload.recurEndDate !== undefined;
    if (!hasAny) return;

    await ensureTaskDatabaseProperties();
    const schema = await getDatabaseSchema();

    if (payload.status !== undefined) {
        (properties as Record<string, unknown>)[schema.statusKey] =
            schema.statusType === 'status'
                ? { status: { name: payload.status } }
                : { select: { name: payload.status } };
    }
    if (payload.agent !== undefined && schema.agentKey) {
        (properties as Record<string, unknown>)[schema.agentKey] = { select: { name: payload.agent } };
    }
    if (payload.description !== undefined && schema.descriptionKey) {
        (properties as Record<string, unknown>)[schema.descriptionKey] = {
            rich_text: [{ type: 'text' as const, text: { content: payload.description } }],
        };
    }
    if (payload.dueDate !== undefined && schema.dueDateKey) {
        (properties as Record<string, unknown>)[schema.dueDateKey] =
            payload.dueDate != null && payload.dueDate !== ''
                ? { date: { start: payload.dueDate } }
                : { date: null };
    }
    if (payload.important !== undefined) {
        const prop = schema.importantProperty;
        if (prop) {
            const propKey = prop.key;
            if (prop.type === 'select' && prop.selectOptions) {
                const name = payload.important ? prop.selectOptions[0] : prop.selectOptions[1];
                (properties as Record<string, unknown>)[propKey] = name ? { select: { name } } : { select: null };
            } else {
                (properties as Record<string, unknown>)[propKey] = { checkbox: payload.important };
            }
        }
    }
    if (payload.urgent !== undefined) {
        const prop = schema.urgentProperty;
        if (prop) {
            const propKey = prop.key;
            if (prop.type === 'select' && prop.selectOptions) {
                const name = payload.urgent ? prop.selectOptions[0] : prop.selectOptions[1];
                (properties as Record<string, unknown>)[propKey] = name ? { select: { name } } : { select: null };
            } else {
                (properties as Record<string, unknown>)[propKey] = { checkbox: payload.urgent };
            }
        }
    }
    if (payload.recurring !== undefined && schema.recurringKey) {
        (properties as Record<string, unknown>)[schema.recurringKey] = { checkbox: payload.recurring };
    }
    if (payload.cron !== undefined && schema.cronKey) {
        (properties as Record<string, unknown>)[schema.cronKey] =
            payload.cron != null && payload.cron !== ''
                ? { rich_text: [{ type: 'text' as const, text: { content: payload.cron } }] }
                : { rich_text: [] };
    }
    if (payload.cronJobId !== undefined && schema.cronJobIdKey) {
        (properties as Record<string, unknown>)[schema.cronJobIdKey] =
            payload.cronJobId != null && payload.cronJobId !== ''
                ? { rich_text: [{ type: 'text' as const, text: { content: payload.cronJobId } }] }
                : { rich_text: [] };
    }
    if (payload.recurUnit !== undefined && schema.recurUnitKey) {
        const recurUnitValue = toNotionRecurUnitValue(payload.recurUnit);
        (properties as Record<string, unknown>)[schema.recurUnitKey] =
            recurUnitValue != null && recurUnitValue !== ''
                ? (schema.recurUnitType === 'select'
                    ? { select: { name: recurUnitValue } }
                    : { rich_text: [{ type: 'text' as const, text: { content: recurUnitValue } }] })
                : (schema.recurUnitType === 'select' ? { select: null } : { rich_text: [] });
    }
    if (payload.recurInterval !== undefined && schema.recurIntervalKey) {
        (properties as Record<string, unknown>)[schema.recurIntervalKey] =
            payload.recurInterval != null ? { number: payload.recurInterval } : { number: null };
    }
    if (payload.recurTime !== undefined && schema.recurTimeKey) {
        (properties as Record<string, unknown>)[schema.recurTimeKey] =
            payload.recurTime != null && payload.recurTime !== ''
                ? { rich_text: [{ type: 'text' as const, text: { content: payload.recurTime } }] }
                : { rich_text: [] };
    }
    if (payload.recurEnd !== undefined && schema.recurEndKey) {
        (properties as Record<string, unknown>)[schema.recurEndKey] =
            payload.recurEnd != null && payload.recurEnd !== ''
                ? { rich_text: [{ type: 'text' as const, text: { content: payload.recurEnd } }] }
                : { rich_text: [] };
    }
    if (payload.recurEndCount !== undefined && schema.recurEndCountKey) {
        (properties as Record<string, unknown>)[schema.recurEndCountKey] =
            payload.recurEndCount != null ? { number: payload.recurEndCount } : { number: null };
    }
    if (payload.recurEndDate !== undefined && schema.recurEndDateKey) {
        (properties as Record<string, unknown>)[schema.recurEndDateKey] =
            payload.recurEndDate != null && payload.recurEndDate !== ''
                ? { date: { start: payload.recurEndDate } }
                : { date: null };
    }

    const res = await fetch(`${NOTION_API}/pages/${normalizedId}`, {
        method: 'PATCH',
        headers: notionHeaders(apiKey),
        body: JSON.stringify({ properties }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Notion API error ${res.status}: ${err}`);
    }
    invalidateTasksCache();
}

/** Update a task's status (To Do / Doing / Done) – convenience wrapper */
export async function updateTaskStatus(pageId: string, status: TaskStatus): Promise<void> {
    await updateTaskProperties(pageId, { status });
}

function extractDescription(properties: Record<string, unknown>): string | undefined {
    const descProp = properties?.Description ?? properties?.description;
    if (!descProp || typeof descProp !== 'object') return undefined;
    const prop = descProp as { rich_text?: Array<{ plain_text?: string }> };
    const text = prop.rich_text?.map((t) => t.plain_text ?? '').join('').trim();
    return text || undefined;
}

function extractDueDate(properties: Record<string, unknown>): string | undefined {
    const dateProp = properties?.Due ?? properties?.['Due date'] ?? properties?.Date ?? properties?.['Due Date'];
    if (!dateProp || typeof dateProp !== 'object') return undefined;
    const prop = dateProp as { date?: { start?: string; end?: string } };
    return prop.date?.start ?? undefined;
}

/** Fetch page block children and convert to plain text; optional Description property */
export async function getPageContent(pageId: string): Promise<NotionPageContent> {
    const { apiKey } = getConfig();
    const normalizedId = normalizeNotionId(pageId);
    const lines: string[] = [];
    let cursor: string | undefined;

    do {
        const url = new URL(`${NOTION_API}/blocks/${normalizedId}/children`);
        url.searchParams.set('page_size', '100');
        if (cursor) url.searchParams.set('start_cursor', cursor);

        const res = await fetch(url.toString(), { headers: notionHeaders(apiKey) });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Notion API error ${res.status}: ${err}`);
        }
        const data = (await res.json()) as {
            results?: Array<{
                type?: string;
                paragraph?: { rich_text?: Array<{ plain_text?: string }> };
                heading_1?: { rich_text?: Array<{ plain_text?: string }> };
                heading_2?: { rich_text?: Array<{ plain_text?: string }> };
                heading_3?: { rich_text?: Array<{ plain_text?: string }> };
                bulleted_list_item?: { rich_text?: Array<{ plain_text?: string }> };
                numbered_list_item?: { rich_text?: Array<{ plain_text?: string }> };
                to_do?: { rich_text?: Array<{ plain_text?: string }> };
                quote?: { rich_text?: Array<{ plain_text?: string }> };
                code?: { rich_text?: Array<{ plain_text?: string }> };
            }>;
            next_cursor?: string | null;
            has_more?: boolean;
        };

        for (const block of data.results ?? []) {
            const type = block.type ?? 'paragraph';
            const richText =
                (block as Record<string, unknown>)[type] as
                    | { rich_text?: Array<{ plain_text?: string }> }
                    | undefined;
            const text = richText?.rich_text?.map((t) => t.plain_text ?? '').join('') ?? '';
            if (text.trim()) lines.push(text.trim());
        }
        cursor = data.next_cursor ?? undefined;
        if (!data.has_more) break;
    } while (cursor);

    return { body: lines.join('\n\n') };
}

/** Fetch full task details: page properties (description, due date, etc.) + block body */
export async function getTaskDetails(pageId: string): Promise<TaskDetails> {
    const { apiKey } = getConfig();
    const normalizedId = normalizeNotionId(pageId);

    const [pageRes, body] = await Promise.all([
        fetch(`${NOTION_API}/pages/${normalizedId}`, { headers: notionHeaders(apiKey) }),
        getPageContent(pageId),
    ]);

    if (!pageRes.ok) {
        const err = await pageRes.text();
        throw new Error(`Notion API error ${pageRes.status}: ${err}`);
    }

    const page = (await pageRes.json()) as {
        created_time?: string;
        last_edited_time?: string;
        properties?: Record<string, unknown>;
    };
    const props = page.properties ?? {};

    return {
        title: extractTitle(props),
        status: extractStatus(props),
        agent: extractAgent(props),
        important: extractCheckbox(props, 'Important'),
        urgent: extractCheckbox(props, 'Urgent'),
        description: extractDescription(props),
        dueDate: extractDueDate(props),
        createdAt: page.created_time,
        lastEditedAt: page.last_edited_time,
        body: body.body,
    };
}

/** Fetch all block child IDs of a page (for deletion). */
async function getBlockChildIds(blockId: string): Promise<string[]> {
    const { apiKey } = getConfig();
    const normalizedId = normalizeNotionId(blockId);
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
        const url = new URL(`${NOTION_API}/blocks/${normalizedId}/children`);
        url.searchParams.set('page_size', '100');
        if (cursor) url.searchParams.set('start_cursor', cursor);
        const res = await fetch(url.toString(), { headers: notionHeaders(apiKey) });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Notion API error ${res.status}: ${err}`);
        }
        const data = (await res.json()) as { results?: Array<{ id?: string }>; next_cursor?: string | null; has_more?: boolean };
        for (const block of data.results ?? []) {
            if (block.id) ids.push(block.id);
        }
        cursor = data.next_cursor ?? undefined;
        if (!data.has_more) break;
    } while (cursor);
    return ids;
}

/** Delete a single block (archives it in Notion). */
async function deleteBlock(blockId: string): Promise<void> {
    const { apiKey } = getConfig();
    const normalizedId = normalizeNotionId(blockId);
    const res = await fetch(`${NOTION_API}/blocks/${normalizedId}`, {
        method: 'DELETE',
        headers: notionHeaders(apiKey),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Notion API error ${res.status}: ${err}`);
    }
}

/** Append rich text content to a page as new paragraph blocks */
export async function appendPageContent(pageId: string, text: string): Promise<void> {
    const { apiKey } = getConfig();
    const normalizedId = normalizeNotionId(pageId);
    const lines = text.trim().split(/\n+/).filter(Boolean);
    if (lines.length === 0) return;
    const children = lines.map((content) => ({
        object: 'block' as const,
        type: 'paragraph' as const,
        paragraph: {
            rich_text: [{ type: 'text' as const, text: { content } }],
        },
    }));
    const res = await fetch(`${NOTION_API}/blocks/${normalizedId}/children`, {
        method: 'PATCH',
        headers: notionHeaders(apiKey),
        body: JSON.stringify({ children }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Notion API error ${res.status}: ${err}`);
    }
}

/** Replace all page body content: delete existing block children, then write new content as paragraphs. */
export async function replacePageContent(pageId: string, text: string): Promise<void> {
    const normalizedId = normalizeNotionId(pageId);
    const childIds = await getBlockChildIds(pageId);
    for (const id of childIds) {
        await deleteBlock(id);
    }
    const trimmed = text.trim();
    if (trimmed.length > 0) {
        await appendPageContent(normalizedId, trimmed);
    }
}

/** Archive (soft-delete) a page */
export async function archiveTask(pageId: string): Promise<void> {
    const { apiKey } = getConfig();
    const normalizedId = normalizeNotionId(pageId);
    const res = await fetch(`${NOTION_API}/pages/${normalizedId}`, {
        method: 'PATCH',
        headers: notionHeaders(apiKey),
        body: JSON.stringify({ archived: true }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Notion API error ${res.status}: ${err}`);
    }
    invalidateTasksCache();
}

/** Create a new task in the database with title, status, agent, and optional description, dueDate, important, urgent, recurring, and structured recur fields */
export async function createTask(params: {
    title: string;
    status?: TaskStatus;
    agent: string;
    description?: string;
    dueDate?: string | null;
    important?: boolean;
    urgent?: boolean;
    recurring?: boolean;
    cron?: string;
    cronJobId?: string;
    recurUnit?: string | null;
    recurInterval?: number | null;
    recurTime?: string | null;
    recurEnd?: string | null;
    recurEndCount?: number | null;
    recurEndDate?: string | null;
}): Promise<NotionTask> {
    await ensureTaskDatabaseProperties();
    const { apiKey, databaseId } = getConfig();
    const schema = await getDatabaseSchema();
    const status = params.status ?? 'To Do';
    const statusPayload =
        schema.statusType === 'status'
            ? { status: { name: status } }
            : { select: { name: status } };

    const properties: Record<string, unknown> = {
        [schema.titleKey]: {
            title: [{ type: 'text', text: { content: params.title } }],
        },
        [schema.statusKey]: statusPayload,
        ...(schema.agentKey ? { [schema.agentKey]: { select: { name: params.agent } } } : {}),
    };
    if (params.description != null && params.description !== '' && schema.descriptionKey) {
        (properties as Record<string, unknown>)[schema.descriptionKey] = {
            rich_text: [{ type: 'text' as const, text: { content: params.description } }],
        };
    }
    if (schema.recurringKey && params.recurring !== undefined) {
        (properties as Record<string, unknown>)[schema.recurringKey] = { checkbox: params.recurring };
    }
    if (schema.cronKey && params.cron != null && params.cron !== '') {
        (properties as Record<string, unknown>)[schema.cronKey] = {
            rich_text: [{ type: 'text' as const, text: { content: params.cron } }],
        };
    }
    if (schema.cronJobIdKey && params.cronJobId != null && params.cronJobId !== '') {
        (properties as Record<string, unknown>)[schema.cronJobIdKey] = {
            rich_text: [{ type: 'text' as const, text: { content: params.cronJobId } }],
        };
    }
    const recurUnitValue = toNotionRecurUnitValue(params.recurUnit);
    if (schema.recurUnitKey && recurUnitValue != null && recurUnitValue !== '') {
        (properties as Record<string, unknown>)[schema.recurUnitKey] =
            schema.recurUnitType === 'select'
                ? { select: { name: recurUnitValue } }
                : { rich_text: [{ type: 'text' as const, text: { content: recurUnitValue } }] };
    }
    if (schema.recurIntervalKey && params.recurInterval != null) {
        (properties as Record<string, unknown>)[schema.recurIntervalKey] = { number: params.recurInterval };
    }
    if (schema.recurTimeKey && params.recurTime != null && params.recurTime !== '') {
        (properties as Record<string, unknown>)[schema.recurTimeKey] = {
            rich_text: [{ type: 'text' as const, text: { content: params.recurTime } }],
        };
    }
    if (schema.recurEndKey && params.recurEnd != null && params.recurEnd !== '') {
        (properties as Record<string, unknown>)[schema.recurEndKey] = {
            rich_text: [{ type: 'text' as const, text: { content: params.recurEnd } }],
        };
    }
    if (schema.recurEndCountKey && params.recurEndCount != null) {
        (properties as Record<string, unknown>)[schema.recurEndCountKey] = { number: params.recurEndCount };
    }
    if (schema.recurEndDateKey && params.recurEndDate != null && params.recurEndDate !== '') {
        (properties as Record<string, unknown>)[schema.recurEndDateKey] = { date: { start: params.recurEndDate } };
    }
    if (schema.dueDateKey && params.dueDate !== undefined) {
        (properties as Record<string, unknown>)[schema.dueDateKey] =
            params.dueDate != null && params.dueDate !== ''
                ? { date: { start: params.dueDate } }
                : { date: null };
    }
    if (params.important !== undefined && schema.importantProperty) {
        const prop = schema.importantProperty;
        const propKey = prop.key;
        if (prop.type === 'select' && prop.selectOptions) {
            const name = params.important ? prop.selectOptions[0] : prop.selectOptions[1];
            (properties as Record<string, unknown>)[propKey] = name ? { select: { name } } : { select: null };
        } else {
            (properties as Record<string, unknown>)[propKey] = { checkbox: params.important };
        }
    }
    if (params.urgent !== undefined && schema.urgentProperty) {
        const prop = schema.urgentProperty;
        const propKey = prop.key;
        if (prop.type === 'select' && prop.selectOptions) {
            const name = params.urgent ? prop.selectOptions[0] : prop.selectOptions[1];
            (properties as Record<string, unknown>)[propKey] = name ? { select: { name } } : { select: null };
        } else {
            (properties as Record<string, unknown>)[propKey] = { checkbox: params.urgent };
        }
    }

    const res = await fetch(`${NOTION_API}/pages`, {
        method: 'POST',
        headers: notionHeaders(apiKey),
        body: JSON.stringify({
            parent: { database_id: databaseId },
            properties,
        }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Notion API error ${res.status}: ${err}`);
    }
    invalidateTasksCache();
    const page = (await res.json()) as { id: string; properties?: Record<string, unknown> };
    const props = page.properties ?? {};
    const task: NotionTask = {
        id: page.id,
        notionPageId: page.id,
        title: extractTitle(props),
        status: extractStatus(props),
        agent: extractAgent(props),
        important: extractCheckbox(props, 'Important'),
        urgent: extractCheckbox(props, 'Urgent'),
        dueDate: extractDueDate(props),
    };
    if (schema.recurringKey) task.recurring = extractCheckboxByKey(props, schema.recurringKey);
    if (schema.cronKey) task.cron = extractRichTextByKey(props, schema.cronKey);
    if (schema.cronJobIdKey) task.cronJobId = extractRichTextByKey(props, schema.cronJobIdKey);
    if (schema.recurUnitKey) task.recurUnit = normalizeRecurUnitValue(extractTextOrSelectByKey(props, schema.recurUnitKey));
    if (schema.recurIntervalKey) task.recurInterval = extractNumberByKey(props, schema.recurIntervalKey);
    if (schema.recurTimeKey) task.recurTime = extractRichTextByKey(props, schema.recurTimeKey) ?? undefined;
    if (schema.recurEndKey) task.recurEnd = extractRichTextByKey(props, schema.recurEndKey) ?? undefined;
    if (schema.recurEndCountKey) task.recurEndCount = extractNumberByKey(props, schema.recurEndCountKey);
    if (schema.recurEndDateKey) task.recurEndDate = extractDateByKey(props, schema.recurEndDateKey) ?? undefined;
    return task;
}
