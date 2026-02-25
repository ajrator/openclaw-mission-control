/**
 * Mission Control preferences stored under ~/.openclaw/mission-control.json.
 * Used for optional features like "Use Notion for tasks".
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { isNotionConfigured } from '@/lib/notion';

const PREFS_FILE = 'mission-control.json';

function getPrefsPath(): string {
    return path.join(os.homedir(), '.openclaw', PREFS_FILE);
}

export interface MissionControlPrefs {
    /** When true, unified tasks API includes Notion tasks. When false, only local tasks. Default derived from isNotionConfigured() when file missing. */
    notionTasksEnabled?: boolean;
    /** ISO timestamp when onboarding was completed. When set, user is not redirected to /onboarding. */
    onboardingCompletedAt?: string;
    /** True if user skipped Notion in onboarding. */
    onboardingSkippedNotion?: boolean;
    /** True if user skipped OpenAI/Codex in onboarding. */
    onboardingSkippedOpenAI?: boolean;
}

function readPrefsRaw(): MissionControlPrefs | null {
    const filePath = getPrefsPath();
    if (!fs.existsSync(filePath)) return null;
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw) as MissionControlPrefs;
        return data && typeof data === 'object' ? data : null;
    } catch {
        return null;
    }
}

/** Whether onboarding has been completed. When false, app should redirect to /onboarding. */
export function isOnboardingCompleted(): boolean {
    const prefs = readPrefsRaw();
    const at = prefs?.onboardingCompletedAt;
    return typeof at === 'string' && at.length > 0;
}

/** Whether Notion tasks are included in the unified task list. Default: true when Notion is configured, false otherwise. */
export function isNotionTasksEnabled(): boolean {
    const prefs = readPrefsRaw();
    if (prefs && typeof prefs.notionTasksEnabled === 'boolean') {
        return prefs.notionTasksEnabled;
    }
    return isNotionConfigured();
}

/** Write preference updates (merge with existing). */
export function writeMissionControlPrefs(updates: Partial<MissionControlPrefs>): void {
    const filePath = getPrefsPath();
    const dir = path.dirname(filePath);
    const existing = readPrefsRaw() ?? {};
    const next = { ...existing, ...updates };
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(next, null, 2) + '\n', 'utf-8');
    try {
        fs.chmodSync(filePath, 0o600);
    } catch {
        /* ignore */
    }
}
