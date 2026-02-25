import { getUnifiedTasks } from '@/lib/unified-tasks';
import { TasksKanban } from '@/components/TasksKanban';
import { NotionSelectDatabase } from '@/components/NotionSelectDatabase';
import { isNotionConfigured, isNotionOAuthEnvSet } from '@/lib/notion';
import Link from 'next/link';

export default async function TasksPage({
    searchParams,
}: {
    searchParams: Promise<{ step?: string; notion?: string }>;
}) {
    const notionConfigured = isNotionConfigured();
    const params = await searchParams;
    const step = params?.step;
    const notionParam = params?.notion;
    const oauthEnvSet = isNotionOAuthEnvSet();

    if (notionConfigured && step === 'select-database') {
        return (
            <div className="page">
                <div className="page-header">
                    <div>
                        <h1 className="page-title">Tasks</h1>
                        <p className="page-subtitle">Connect Notion</p>
                    </div>
                </div>
                <div className="empty-state notion-optional-state">
                    <NotionSelectDatabase />
                </div>
            </div>
        );
    }

    let result: Awaited<ReturnType<typeof getUnifiedTasks>>;
    let error: string | null = null;
    try {
        result = await getUnifiedTasks();
    } catch (e) {
        error = e instanceof Error ? e.message : 'Failed to load tasks';
        result = {
            tasks: [],
            agentOptions: [],
            notionEnabled: false,
            notionConfigured: false,
        };
    }

    const { tasks, agentOptions, notionEnabled } = result;

    const subtitle =
        notionConfigured && notionEnabled
            ? 'Notion and local tasks'
            : notionConfigured && !notionEnabled
              ? 'Using local tasks only'
              : 'Local tasks';

    const hintCopy =
        !notionConfigured
            ? "Notion is optional. You're using local tasks only. Connect Notion in Integrations to sync with a database."
            : !notionEnabled
              ? 'Notion is optional; connect in Integrations if you want to sync with Notion.'
              : null;

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-title">Tasks</h1>
                    <p className="page-subtitle">{subtitle}</p>
                    {hintCopy && (
                        <p className="page-subtitle" style={{ marginTop: 4, fontSize: 13, fontWeight: 400 }}>
                            {hintCopy}{' '}
                            <Link href="/integrations" className="link">
                                Integrations
                            </Link>
                        </p>
                    )}
                </div>
            </div>

            {!notionConfigured && (
                <div className="notion-optional-banner">
                    {notionParam === 'denied' && (
                        <p className="empty-state-title" style={{ marginBottom: 8 }}>Notion access was denied.</p>
                    )}
                    {notionParam === 'error' && (
                        <p className="empty-state-title" style={{ marginBottom: 8, color: 'var(--red, #ef4444)' }}>
                            Something went wrong connecting to Notion.
                        </p>
                    )}
                </div>
            )}

            {error && (
                <div className="error-banner" role="alert">
                    {error}
                </div>
            )}

            <TasksKanban
                initialTasks={tasks}
                initialAgentOptions={agentOptions}
                notionEnabled={notionEnabled && notionConfigured}
            />
        </div>
    );
}
