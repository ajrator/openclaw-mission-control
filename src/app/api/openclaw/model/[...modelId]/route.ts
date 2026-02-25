import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ modelId: string[] }> }
) {
    try {
        const segments = await params;
        const rawId = Array.isArray(segments.modelId) ? segments.modelId.join('/') : (segments as unknown as { modelId: string }).modelId;
        const modelId = typeof rawId === 'string' ? decodeURIComponent(rawId).trim() : '';
        if (!modelId) {
            return NextResponse.json({ error: 'Missing model ID' }, { status: 400 });
        }

        const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
        if (!fs.existsSync(configPath)) {
            return NextResponse.json({ error: 'openclaw.json not found' }, { status: 404 });
        }

        const raw = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(raw) as Record<string, unknown>;
        if (!config.agents || typeof config.agents !== 'object') {
            return NextResponse.json({ error: 'Invalid config' }, { status: 500 });
        }

        const agents = config.agents as {
            defaults?: {
                models?: Record<string, unknown>;
                model?: { primary?: string; fallbacks?: string[] };
            };
            list?: Array<{
                id: string;
                model?: string | { primary?: string; fallbacks?: string[] };
            }>;
        };

        const defaults = agents.defaults ?? {};
        const modelsObj = defaults.models ?? {};
        const currentIds = Object.keys(modelsObj as Record<string, unknown>);
        if (!currentIds.includes(modelId)) {
            return NextResponse.json({ error: 'Model not in available list' }, { status: 404 });
        }
        if (currentIds.length <= 1) {
            return NextResponse.json(
                { error: 'Cannot remove the last model. Add another model first.' },
                { status: 400 }
            );
        }

        const defaultModel = defaults.model;
        const primary = typeof defaultModel === 'object' && defaultModel?.primary ? defaultModel.primary : undefined;
        const fallbacks = Array.isArray(defaultModel?.fallbacks) ? defaultModel.fallbacks : [];

        const remainingIds = currentIds.filter((id) => id !== modelId);
        const newPrimary = primary === modelId ? (remainingIds[0] ?? '') : primary;
        const newDefaultFallbacks = (fallbacks ?? []).filter((f) => f !== modelId);

        (defaults.models as Record<string, unknown>) = remainingIds.reduce(
            (acc, id) => ({ ...acc, [id]: (modelsObj as Record<string, unknown>)[id] ?? {} }),
            {} as Record<string, unknown>
        );
        if (defaults.model && typeof defaults.model === 'object') {
            defaults.model.primary = newPrimary;
            defaults.model.fallbacks = newDefaultFallbacks.length > 0 ? newDefaultFallbacks : undefined;
        }

        const list = agents.list ?? [];
        for (const agent of list) {
            const m = agent.model;
            if (typeof m === 'string') {
                if (m === modelId) agent.model = { primary: newPrimary, fallbacks: undefined };
            } else if (m && typeof m === 'object') {
                const p = m.primary === modelId ? newPrimary : m.primary;
                const f = Array.isArray(m.fallbacks) ? m.fallbacks.filter((x) => x !== modelId) : [];
                agent.model = { primary: p ?? newPrimary, fallbacks: f.length > 0 ? f : undefined };
            }
        }

        fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
        return NextResponse.json({ success: true, modelId });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
