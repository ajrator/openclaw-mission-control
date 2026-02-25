import { getOpenClawData } from '@/lib/openclaw';
import { ChatPanel } from '@/components/ChatPanel';
import { notFound } from 'next/navigation';

export default async function ChatAgentPage({
    params,
}: {
    params: Promise<{ agentId: string }>;
}) {
    const { agentId } = await params;
    const data = getOpenClawData();
    const exists = data.agents.some((a) => a.id === agentId);
    if (!exists) notFound();

    return (
        <ChatPanel
            agents={data.agents}
            availableModels={data.availableModels}
            initialAgentId={agentId}
        />
    );
}
