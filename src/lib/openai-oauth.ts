/**
 * OpenAI (ChatGPT/Codex) OAuth helpers for Mission Control.
 * Reads/writes OpenClaw main agent auth-profiles.json for openai-codex:default.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const OPENAI_OAUTH_PROFILE_ID = 'openai-codex:default';
const OPENAI_OAUTH_PROVIDER = 'openai-codex';

function getMainAgentAuthProfilesPath(): string {
    return path.join(os.homedir(), '.openclaw', 'agents', 'main', 'agent', 'auth-profiles.json');
}

/** Whether OPENAI_OAUTH_CLIENT_ID and OPENAI_OAUTH_CLIENT_SECRET are set. */
export function isOpenAIOAuthEnvSet(): boolean {
    const id = process.env.OPENAI_OAUTH_CLIENT_ID?.trim();
    const secret = process.env.OPENAI_OAUTH_CLIENT_SECRET?.trim();
    return !!(id && secret);
}

interface AuthProfileStore {
    version: number;
    profiles: Record<string, unknown>;
    lastGood?: Record<string, string>;
    usageStats?: Record<string, unknown>;
}

function readAuthProfileStore(): AuthProfileStore | null {
    const filePath = getMainAgentAuthProfilesPath();
    if (!fs.existsSync(filePath)) return null;
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw) as AuthProfileStore;
        return data && typeof data === 'object' && typeof data.profiles === 'object' ? data : null;
    } catch {
        return null;
    }
}

/** True if main agent has openai-codex:default oauth profile with non-empty access. Does not expose tokens. */
export function hasOpenAICodexProfile(): boolean {
    const store = readAuthProfileStore();
    const profile = store?.profiles?.[OPENAI_OAUTH_PROFILE_ID] as { type?: string; access?: string } | undefined;
    return !!(profile?.type === 'oauth' && profile?.access?.trim());
}

/** Optional masked accountId for display (e.g. last 4 chars). Returns null if not connected or no accountId. */
export function getOpenAICodexProfileAccountIdMasked(): string | null {
    const store = readAuthProfileStore();
    const profile = store?.profiles?.[OPENAI_OAUTH_PROFILE_ID] as { type?: string; accountId?: string } | undefined;
    if (profile?.type !== 'oauth' || !profile?.accountId) return null;
    const id = String(profile.accountId);
    if (id.length <= 4) return id;
    return `…${id.slice(-4)}`;
}

export interface OpenAICodexProfileTokens {
    access: string;
    refresh: string;
    expires: number;
    accountId: string;
}

/** Write or update openai-codex:default in main agent auth-profiles.json. Creates dirs/file if needed. */
export function writeOpenAICodexProfile(tokens: OpenAICodexProfileTokens): void {
    const filePath = getMainAgentAuthProfilesPath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    const existing = readAuthProfileStore();
    const store: AuthProfileStore = existing ?? {
        version: 1,
        profiles: {},
        lastGood: {},
        usageStats: {},
    };
    if (!store.profiles) store.profiles = {};
    if (!store.lastGood) store.lastGood = {};
    if (!store.usageStats) store.usageStats = {};

    store.profiles[OPENAI_OAUTH_PROFILE_ID] = {
        type: 'oauth',
        provider: OPENAI_OAUTH_PROVIDER,
        access: tokens.access,
        refresh: tokens.refresh,
        expires: tokens.expires,
        accountId: tokens.accountId,
    };
    store.lastGood[OPENAI_OAUTH_PROVIDER] = OPENAI_OAUTH_PROFILE_ID;
    if (!store.usageStats[OPENAI_OAUTH_PROFILE_ID]) {
        (store.usageStats as Record<string, unknown>)[OPENAI_OAUTH_PROFILE_ID] = { errorCount: 0 };
    }

    fs.writeFileSync(filePath, JSON.stringify(store, null, 2) + '\n', 'utf-8');
    try {
        fs.chmodSync(filePath, 0o600);
    } catch {
        /* ignore on unsupported platforms */
    }
}

/** Remove openai-codex:default from auth-profiles and lastGood. */
export function removeOpenAICodexProfile(): void {
    const store = readAuthProfileStore();
    if (!store) return;
    const filePath = getMainAgentAuthProfilesPath();
    delete store.profiles[OPENAI_OAUTH_PROFILE_ID];
    if (store.lastGood) delete store.lastGood[OPENAI_OAUTH_PROVIDER];
    if (store.usageStats) delete (store.usageStats as Record<string, unknown>)[OPENAI_OAUTH_PROFILE_ID];
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2) + '\n', 'utf-8');
    try {
        fs.chmodSync(filePath, 0o600);
    } catch {
        /* ignore */
    }
}

// --- PKCE helpers ---

function base64UrlEncode(buffer: Buffer): string {
    return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Generate PKCE code_verifier (32 bytes, base64url). */
export function generateCodeVerifier(): string {
    return base64UrlEncode(crypto.randomBytes(32));
}

/** Compute code_challenge = base64url(SHA256(verifier)). */
export function computeCodeChallenge(verifier: string): string {
    const hash = crypto.createHash('sha256').update(verifier, 'utf-8').digest();
    return base64UrlEncode(hash);
}
