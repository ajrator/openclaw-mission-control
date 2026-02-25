import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { sanitizeAgentFallbacks } from '@/lib/agent-models';

const configPath = () => path.join(os.homedir(), '.openclaw', 'openclaw.json');

/** Add existing provider model to defaults.models by modelId (e.g. openai-codex/gpt-5.3). */
function addExistingModelToDefaults(config: Record<string, unknown>, modelId: string): string | null {
    const providers = (config as any)?.models?.providers as Record<string, { models?: Array<{ id: string }> }> | undefined;
    if (!providers) return null;
    const slash = modelId.indexOf('/');
    const providerKey = slash >= 0 ? modelId.slice(0, slash) : modelId;
    const modelIdInProvider = slash >= 0 ? modelId.slice(slash + 1) : modelId;
    const provider = providers[providerKey];
    const exists = provider?.models?.some((m) => m.id === modelIdInProvider);
    if (!exists) return null;

    if (!config.agents || typeof config.agents !== 'object') (config as any).agents = {};
    const agents = config.agents as { defaults?: { models?: Record<string, unknown> } };
    if (!agents.defaults) agents.defaults = {};
    if (!agents.defaults.models || typeof agents.defaults.models !== 'object') agents.defaults.models = {};
    (agents.defaults.models as Record<string, unknown>)[modelId] = {};
    return modelId;
}

/** Add new provider and/or model; add full model id to defaults.models. */
function addNewProviderOrModel(
    config: Record<string, unknown>,
    body: {
        providerKey: string;
        baseUrl?: string;
        apiKey?: string;
        api?: string;
        auth?: 'api-key' | 'aws-sdk' | 'oauth' | 'token';
        authHeader?: boolean;
        headers?: Record<string, string>;
        model: {
            id: string;
            name: string;
            reasoning?: boolean;
            input?: Array<'text' | 'image'>;
            contextWindow: number;
            maxTokens: number;
            cost: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
        };
    }
): string | null {
    const slug = body.providerKey.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
    if (!slug) return null;
    const fullId = `${slug}/${body.model.id}`;

    if (!config.models || typeof config.models !== 'object') (config as any).models = {};
    const modelsConfig = config.models as { providers?: Record<string, unknown> };
    if (!modelsConfig.providers || typeof modelsConfig.providers !== 'object') modelsConfig.providers = {};
    let provider = modelsConfig.providers[slug] as Record<string, unknown> | undefined;
    if (!provider) {
        provider = {
            baseUrl: body.baseUrl ?? '',
            apiKey: body.apiKey ?? '',
            api: body.api ?? 'openai-completions',
            models: [],
        };
        modelsConfig.providers[slug] = provider;
    }
    const models = Array.isArray(provider.models) ? provider.models : [];
    if (typeof body.baseUrl === 'string') provider.baseUrl = body.baseUrl;
    if (typeof body.apiKey === 'string') provider.apiKey = body.apiKey;
    if (typeof body.api === 'string') provider.api = body.api;
    if (body.auth) provider.auth = body.auth;
    if (typeof body.authHeader === 'boolean') provider.authHeader = body.authHeader;
    if (body.headers && typeof body.headers === 'object' && Object.keys(body.headers).length > 0) {
        provider.headers = body.headers;
    }

    const cost = body.model.cost;
    const modelDef = {
        id: body.model.id,
        name: body.model.name,
        reasoning: Boolean(body.model.reasoning),
        input: Array.isArray(body.model.input) && body.model.input.length > 0 ? body.model.input : ['text'],
        cost: {
            input: Number(cost?.input) ?? 0,
            output: Number(cost?.output) ?? 0,
            cacheRead: Number(cost?.cacheRead) ?? 0,
            cacheWrite: Number(cost?.cacheWrite) ?? 0,
        },
        contextWindow: Number(body.model.contextWindow) || 128000,
        maxTokens: Number(body.model.maxTokens) || 4096,
    };
    const existingIdx = models.findIndex((m: { id?: string }) => m.id === body.model.id);
    if (existingIdx >= 0) (models as unknown[])[existingIdx] = modelDef;
    else models.push(modelDef);
    provider.models = models;

    if (!config.agents || typeof config.agents !== 'object') (config as any).agents = {};
    const agents = config.agents as { defaults?: { models?: Record<string, unknown> } };
    if (!agents.defaults) agents.defaults = {};
    if (!agents.defaults.models || typeof agents.defaults.models !== 'object') agents.defaults.models = {};
    (agents.defaults.models as Record<string, unknown>)[fullId] = {};
    return fullId;
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { agentId, model, fallbacks, modelId, providerKey } = body;

        const configPathVal = configPath();
        if (!fs.existsSync(configPathVal)) {
            return NextResponse.json({ error: 'openclaw.json not found' }, { status: 404 });
        }

        const raw = fs.readFileSync(configPathVal, 'utf-8');
        const config = JSON.parse(raw) as Record<string, unknown>;

        if (agentId != null && agentId !== '') {
            if (!config.agents) (config as any).agents = {};
            const agentsConfig = config.agents as { list?: Array<{ id: string; model?: unknown }> };
            if (!Array.isArray(agentsConfig.list)) agentsConfig.list = [];

            let agentEntry = agentsConfig.list.find((a: { id: string }) => a.id === agentId);
            if (!agentEntry) {
                agentEntry = { id: agentId };
                agentsConfig.list.push(agentEntry);
            }

            const currentModel = agentEntry.model;
            const currentPrimary = typeof currentModel === 'string' ? currentModel : (currentModel as { primary?: string })?.primary;
            const currentFallbacks = Array.isArray((currentModel as { fallbacks?: string[] })?.fallbacks) ? (currentModel as { fallbacks?: string[] }).fallbacks : [];

            const primary = model !== undefined ? model : currentPrimary;
            const rawFallbacks = fallbacks !== undefined ? (Array.isArray(fallbacks) ? fallbacks : []) : (currentFallbacks ?? []);

            if (primary === undefined && rawFallbacks.length === 0) {
                return NextResponse.json({ error: 'Missing model (primary)' }, { status: 400 });
            }

            const finalPrimary = (primary ?? currentPrimary ?? '').trim();
            const nextFallbacks = sanitizeAgentFallbacks(finalPrimary, rawFallbacks);

            agentEntry.model = {
                primary: finalPrimary,
                fallbacks: nextFallbacks.length > 0 ? nextFallbacks : undefined,
            };

            fs.writeFileSync(configPathVal, JSON.stringify(config, null, 2) + '\n', 'utf-8');
            return NextResponse.json({
                success: true,
                model: (agentEntry.model as { primary: string }).primary,
                fallbacks: (agentEntry.model as { fallbacks?: string[] }).fallbacks,
            });
        }

        if (typeof modelId === 'string' && modelId.trim()) {
            const added = addExistingModelToDefaults(config, modelId.trim());
            if (!added) {
                return NextResponse.json(
                    { error: 'Model not found in any provider. Add the provider and model first.' },
                    { status: 400 }
                );
            }
            fs.writeFileSync(configPathVal, JSON.stringify(config, null, 2) + '\n', 'utf-8');
            return NextResponse.json({ success: true, modelId: added });
        }

        if (typeof providerKey === 'string' && body.model && typeof body.model === 'object') {
            const added = addNewProviderOrModel(config, {
                providerKey: body.providerKey,
                baseUrl: body.baseUrl,
                apiKey: body.apiKey,
                api: body.api,
                auth: body.auth,
                authHeader: body.authHeader,
                headers: body.headers,
                model: body.model,
            });
            if (!added) {
                return NextResponse.json({ error: 'Invalid provider or model payload' }, { status: 400 });
            }
            fs.writeFileSync(configPathVal, JSON.stringify(config, null, 2) + '\n', 'utf-8');
            return NextResponse.json({ success: true, modelId: added });
        }

        return NextResponse.json({ error: 'Missing agentId, modelId, or providerKey+model' }, { status: 400 });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
