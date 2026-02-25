import fs from 'fs';
import path from 'path';
import os from 'os';
import { sanitizeAgentFallbacks } from '@/lib/agent-models';

export interface Skill {
    name: string;
    description: string;
    source: string;
    filePath: string;
}

export interface AgentSession {
    sessionId: string;
    updatedAt: number;
    model: string;
    modelProvider: string;
    compactionCount: number;
    skills: Skill[];
}

export interface Agent {
    id: string;
    name: string;
    emoji?: string;
    configuredModel?: string;
    fallbacks?: string[];
    availableModels?: string[];
    sessions: AgentSession[];
}

export interface OpenClawData {
    agents: Agent[];
    config: Record<string, unknown>;
    availableModels: string[];
}

/** Model row for Models page: enabled model with provider info and platform link */
export interface ModelWithProvider {
    id: string;
    providerKey: string;
    name: string;
    contextWindow?: number;
    maxTokens?: number;
    cost?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
}

/** Provider key -> usage/dashboard URL. Local/custom providers (e.g. lmstudio) have no URL. */
export const PROVIDER_PLATFORM_URLS: Record<string, string> = {
    'openai-codex': 'https://platform.openai.com/usage',
    'anthropic': 'https://console.anthropic.com/settings/usage',
    'google-gemini-cli': 'https://aistudio.google.com/',
    'google-antigravity': 'https://aistudio.google.com/',
    'github-copilot': 'https://github.com/settings/copilot',
    'minimax': 'https://api.minimax.chat/',
    'xiaomi': 'https://api.xiaomi.ai/',
    'zai': 'https://z.ai/',
};

function readJsonSafe<T>(filePath: string): T | null {
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
}

export function getOpenClawData(): OpenClawData {
    const openclawDir = path.join(os.homedir(), '.openclaw');
    const agentsDir = path.join(openclawDir, 'agents');
    const configPath = path.join(openclawDir, 'openclaw.json');

    const config = readJsonSafe<Record<string, unknown>>(configPath) ?? {};
    const agents: Agent[] = [];
    const availableModels = Object.keys((config as any)?.agents?.defaults?.models || {});

    if (fs.existsSync(agentsDir)) {
        const agentNames = fs.readdirSync(agentsDir).filter((name) => {
            const p = path.join(agentsDir, name);
            return fs.statSync(p).isDirectory();
        });

        for (const agentName of agentNames) {
            const sessionsJsonPath = path.join(agentsDir, agentName, 'sessions', 'sessions.json');
            const sessionsData = readJsonSafe<Record<string, unknown>>(sessionsJsonPath);
            const sessions: AgentSession[] = [];

            if (sessionsData) {
                for (const [, sessionRaw] of Object.entries(sessionsData)) {
                    const session = sessionRaw as Record<string, unknown>;
                    const skillsSnapshot = session.skillsSnapshot as {
                        resolvedSkills?: Array<{ name: string; description: string; source: string; filePath: string }>;
                    } | undefined;

                    sessions.push({
                        sessionId: session.sessionId as string,
                        updatedAt: session.updatedAt as number,
                        model: (session.model as string) ?? 'unknown',
                        modelProvider: (session.modelProvider as string) ?? 'unknown',
                        compactionCount: (session.compactionCount as number) ?? 0,
                        skills: (skillsSnapshot?.resolvedSkills ?? []).map((s) => ({
                            name: s.name,
                            description: s.description,
                            source: s.source,
                            filePath: s.filePath,
                        })),
                    });
                }
            }

            let finalName = agentName;
            let finalEmoji: string | undefined;
            let finalFallbacks: string[] | undefined;
            let finalConfiguredModel: string | undefined;
            let finalAvailableModels: string[] | undefined;

            try {
                const defaultsModelKeys = Object.keys((config as any).agents?.defaults?.models || {});
                if (defaultsModelKeys.length > 0) {
                    finalAvailableModels = defaultsModelKeys;
                }
                const defaultsPrimary = (config as any).agents?.defaults?.model?.primary;
                finalConfiguredModel = defaultsPrimary;

                const agentList = (config as any).agents?.list as Array<{
                    id: string;
                    model?: string | { primary?: string; fallbacks?: string[] };
                    identity?: { name?: string; emoji?: string };
                }>;
                if (Array.isArray(agentList)) {
                    const cfg = agentList.find((c) => c.id === agentName);
                    if (cfg?.identity?.name) {
                        finalName = cfg.identity.name;
                    }
                    if (cfg?.identity?.emoji) {
                        finalEmoji = cfg.identity.emoji;
                    }
                    if (cfg?.model !== undefined) {
                        const m = cfg.model;
                        if (typeof m === 'string') {
                            finalConfiguredModel = m || defaultsPrimary;
                        } else if (m && typeof m === 'object') {
                            if (m.primary) finalConfiguredModel = m.primary;
                            else if (defaultsPrimary) finalConfiguredModel = defaultsPrimary;
                            if (Array.isArray(m.fallbacks)) finalFallbacks = m.fallbacks;
                        }
                    }
                }

                const defaultsModel = (config as any).agents?.defaults?.model as { fallbacks?: string[] };
                if (finalFallbacks === undefined && defaultsModel?.fallbacks && Array.isArray(defaultsModel.fallbacks)) {
                    finalFallbacks = defaultsModel.fallbacks;
                }
            } catch (e) {
                // ignore
            }

            agents.push({
                id: agentName,
                name: finalName,
                emoji: finalEmoji,
                configuredModel: finalConfiguredModel,
                fallbacks: finalFallbacks,
                availableModels: finalAvailableModels,
                sessions
            });
        }

        // Sort by config.agents.list order so the UI order is rearrangeable
        const agentList = (config as any).agents?.list as Array<{ id: string }> | undefined;
        if (Array.isArray(agentList) && agentList.length > 0) {
            const orderMap = new Map(agentList.map((a, i) => [a.id, i]));
            agents.sort((a, b) => {
                const ai = orderMap.has(a.id) ? orderMap.get(a.id)! : 1e9;
                const bi = orderMap.has(b.id) ? orderMap.get(b.id)! : 1e9;
                return ai - bi;
            });
        }
    }

    return { agents, config, availableModels };
}

/** Create a new agent (dirs + config). Does not update Notion. Returns { id }. */
export function createAgent(name: string, model: string, fallbacks?: string[]): { id: string } {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const openclawDir = path.join(os.homedir(), '.openclaw');
    const configPath = path.join(openclawDir, 'openclaw.json');
    const agentDir = path.join(openclawDir, 'agents', id);

    if (!fs.existsSync(configPath)) {
        throw new Error('openclaw.json not found');
    }

    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    if (!config.agents || typeof config.agents !== 'object') (config as any).agents = {};
    const agentsConfig = config.agents as {
        list?: Array<{ id: string; model?: { primary: string; fallbacks?: string[] }; identity?: { name?: string } }>;
    };
    if (!Array.isArray(agentsConfig.list)) agentsConfig.list = [];

    if (agentsConfig.list.some((a) => a.id === id)) {
        throw new Error('Agent ID already exists');
    }

    const defaultPrimary = (config as any).agents?.defaults?.model?.primary;
    const defaultModels = Object.keys((config as any).agents?.defaults?.models || {});
    const primary = (model && model.trim()) || defaultPrimary || defaultModels[0] || '';
    const sanitizedFallbacks = sanitizeAgentFallbacks(primary, fallbacks);

    fs.mkdirSync(path.join(agentDir, 'sessions'), { recursive: true });
    fs.mkdirSync(path.join(agentDir, 'agent'), { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'sessions', 'sessions.json'), '{}', 'utf-8');

    const mainAuthPath = path.join(openclawDir, 'agents', 'main', 'agent', 'auth-profiles.json');
    if (fs.existsSync(mainAuthPath)) {
        fs.copyFileSync(mainAuthPath, path.join(agentDir, 'agent', 'auth-profiles.json'));
    }

    agentsConfig.list.push({
        id,
        model: {
            primary,
            fallbacks: sanitizedFallbacks.length > 0 ? sanitizedFallbacks : undefined,
        },
        identity: { name },
    });

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    return { id };
}

const getConfigPath = () => path.join(os.homedir(), '.openclaw', 'openclaw.json');

/** Path to openclaw.json. Used by setup/install to ensure config exists. */
export function getOpenClawConfigPath(): string {
    return getConfigPath();
}

/** Path to .openclaw directory. */
export function getOpenClawDir(): string {
    return path.join(os.homedir(), '.openclaw');
}

/** Gateway WebSocket URL from openclaw.json gateway.port, or null if not configured. */
export function getGatewayUrl(): string | null {
    const config = readJsonSafe<Record<string, unknown>>(getConfigPath());
    const gateway = config?.gateway as { port?: number } | undefined;
    const port = gateway?.port;
    if (typeof port !== 'number' || port <= 0) return null;
    return `ws://127.0.0.1:${port}`;
}

/** OpenClaw dashboard HTTP URL (same host/port as gateway). Null if gateway port not configured. */
export function getDashboardUrl(): string | null {
    const config = readJsonSafe<Record<string, unknown>>(getConfigPath());
    const gateway = config?.gateway as { port?: number } | undefined;
    const port = gateway?.port;
    if (typeof port !== 'number' || port <= 0) return null;
    return `http://127.0.0.1:${port}`;
}

/** Gateway auth (token/password) from openclaw.json for WebSocket connect. Used server-side only. */
export function getGatewayAuth(): { token?: string; password?: string } {
    const config = readJsonSafe<Record<string, unknown>>(getConfigPath());
    const auth = (config?.gateway as { auth?: { token?: string; password?: string } })?.auth;
    if (!auth || typeof auth !== 'object') return {};
    const token = typeof auth.token === 'string' ? auth.token.trim() : undefined;
    const password = typeof auth.password === 'string' ? auth.password.trim() : undefined;
    return { token: token || undefined, password: password || undefined };
}

/**
 * Origin to send when connecting as Control UI (for chat).
 * Uses first gateway.controlUi.allowedOrigins entry, or MISSION_CONTROL_ORIGIN, or "http://localhost:3000".
 * For Chat to work with token auth, openclaw.json must include:
 *   gateway.controlUi.dangerouslyDisableDeviceAuth: true
 *   gateway.controlUi.allowedOrigins: ["http://localhost:3000"]   (or the origin Mission Control is served from)
 */
export function getGatewayControlUiOrigin(): string {
    const config = readJsonSafe<Record<string, unknown>>(getConfigPath());
    const allowed = (config?.gateway as { controlUi?: { allowedOrigins?: string[] } })?.controlUi?.allowedOrigins;
    const first = Array.isArray(allowed) && allowed.length > 0 ? allowed[0]?.trim() : undefined;
    return typeof first === 'string' && first.length > 0 ? first : process.env.MISSION_CONTROL_ORIGIN ?? 'http://localhost:3000';
}

/** Default session key for an agent. Must match gateway default: agent:<agentId>:main. */
export function getDefaultSessionKey(agentId: string): string {
    return `agent:${agentId}:main`;
}

/** Session key for a task (one session per task). Use for start, pause/stop, and delete when Done. */
export function getTaskSessionKey(agentId: string, notionPageId: string): string {
    const safe = (notionPageId ?? '').replace(/[^a-zA-Z0-9-]/g, '-');
    return `agent:${agentId}:task:${safe || 'unknown'}`;
}

/** Map Notion task Agent select value to OpenClaw agent id (by id or name). */
export function resolveAgentIdFromTaskAgent(taskAgent: string | undefined): string | null {
    if (!taskAgent || !taskAgent.trim()) return null;
    const agents = getOpenClawData().agents;
    const needle = taskAgent.trim();
    const found = agents.find((a) => a.id === needle || a.name === needle);
    return found ? found.id : null;
}

type ProviderModelDef = {
    id: string;
    name?: string;
    contextWindow?: number;
    maxTokens?: number;
    cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
};

/** List of enabled models with provider metadata and platform URL. */
export function getModelsWithProviders(): ModelWithProvider[] {
    const config = readJsonSafe<Record<string, unknown>>(getConfigPath());
    if (!config) return [];

    const defaultsModels = (config as any)?.agents?.defaults?.models as Record<string, unknown> | undefined;
    const enabledIds = defaultsModels ? Object.keys(defaultsModels) : [];
    const providers = (config as any)?.models?.providers as Record<string, { models?: ProviderModelDef[] }> | undefined;
    if (!providers) return enabledIds.map((id) => ({ id, providerKey: id.split('/')[0] || id, name: id }));

    const result: ModelWithProvider[] = [];
    for (const id of enabledIds) {
        const slash = id.indexOf('/');
        const providerKey = slash >= 0 ? id.slice(0, slash) : id;
        const modelId = slash >= 0 ? id.slice(slash + 1) : id;
        const provider = providers[providerKey];
        const def = provider?.models?.find((m: ProviderModelDef) => m.id === modelId);
        result.push({
            id,
            providerKey,
            name: def?.name ?? modelId,
            contextWindow: def?.contextWindow,
            maxTokens: def?.maxTokens,
            cost: def?.cost as ModelWithProvider['cost'],
        });
    }
    return result;
}

/** For "Add model" modal: providers and their models not yet in defaults.models */
export function getProvidersAndUnavailableModels(): {
    providerKey: string;
    models: { id: string; fullId: string; name: string }[];
}[] {
    const config = readJsonSafe<Record<string, unknown>>(getConfigPath());
    if (!config) return [];

    const defaultsModels = (config as any)?.agents?.defaults?.models as Record<string, unknown> | undefined;
    const enabledSet = new Set(defaultsModels ? Object.keys(defaultsModels) : []);
    const providers = (config as any)?.models?.providers as Record<string, { models?: ProviderModelDef[] }> | undefined;
    if (!providers) return [];

    const out: { providerKey: string; models: { id: string; fullId: string; name: string }[] }[] = [];
    for (const [providerKey, prov] of Object.entries(providers)) {
        const list = prov?.models ?? [];
        const unavailable = list
            .map((m: ProviderModelDef) => ({
                id: m.id,
                fullId: `${providerKey}/${m.id}`,
                name: m.name ?? m.id,
            }))
            .filter((m) => !enabledSet.has(m.fullId));
        if (unavailable.length > 0) out.push({ providerKey, models: unavailable });
    }
    return out;
}

/** Heartbeat model ID from agents.defaults.heartbeat.model, or null if unset. */
export function getHeartbeatModel(): string | null {
    const config = readJsonSafe<Record<string, unknown>>(getConfigPath());
    const heartbeat = (config as any)?.agents?.defaults?.heartbeat;
    if (!heartbeat || typeof heartbeat !== 'object') return null;
    const model = (heartbeat as { model?: string }).model;
    return typeof model === 'string' && model.trim() ? model.trim() : null;
}

/** Whether the gateway is configured (openclaw.json has gateway.port). */
export function isGatewayConfigured(): boolean {
    return getGatewayUrl() !== null;
}

/** Check if the gateway is reachable (HTTP GET to dashboard URL). Used for setup/onboarding. */
export async function isGatewayReachable(): Promise<boolean> {
    const url = getDashboardUrl();
    if (!url) return false;
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 3000);
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(t);
        return res.ok || res.status === 404 || res.status === 401;
    } catch {
        return false;
    }
}
