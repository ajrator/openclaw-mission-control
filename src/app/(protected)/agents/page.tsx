import { CreateAgentModal } from '@/components/CreateAgentModal';
import { SortableAgentsGrid } from '@/components/SortableAgentsGrid';
import { getOpenClawData } from '@/lib/openclaw';

export default function AgentsPage() {
    const data = getOpenClawData();

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-title">Agents</h1>
                    <p className="page-subtitle">
                        {data.agents.length} agent{data.agents.length !== 1 ? 's' : ''} configured
                    </p>
                </div>
                <div className="header-actions">
                    <div className="header-badge">
                        <span className="pulse-ring" />
                        <span className="pulse-dot" />
                        <span className="header-badge-text">Live</span>
                    </div>
                    <CreateAgentModal availableModels={data.availableModels} />
                </div>
            </div>

            <SortableAgentsGrid agents={data.agents} />
        </div>
    );
}
