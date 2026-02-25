import { getOpenClawData } from '@/lib/openclaw';
import { ChatPanel } from '@/components/ChatPanel';

export default async function ChatPage({
    searchParams,
}: {
    searchParams: Promise<{ agent?: string }>;
}) {
    const params = await searchParams;
    const initialAgentId = typeof params?.agent === 'string' ? params.agent : null;
    const data = getOpenClawData();

    return (
        <ChatPanel
            agents={data.agents}
            availableModels={data.availableModels}
            initialAgentId={initialAgentId}
        />
    );
}
