"use client";

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { AgentCard } from '@/components/AgentCard';
import type { Agent } from '@/lib/openclaw';

interface SortableAgentsGridProps {
    agents: Agent[];
}

function reorderIds(ids: string[], dragId: string, dropId: string): string[] {
    const dragIndex = ids.indexOf(dragId);
    const dropIndex = ids.indexOf(dropId);
    if (dragIndex === -1 || dropIndex === -1 || dragIndex === dropIndex) return ids;
    const next = ids.filter((id) => id !== dragId);
    next.splice(dropIndex > dragIndex ? dropIndex - 1 : dropIndex, 0, dragId);
    return next;
}

function moveInOrder(ids: string[], id: string, dir: -1 | 1): string[] {
    const i = ids.indexOf(id);
    if (i === -1) return ids;
    const j = i + dir;
    if (j < 0 || j >= ids.length) return ids;
    const next = [...ids];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
}

export function SortableAgentsGrid({ agents }: SortableAgentsGridProps) {
    const router = useRouter();
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dropTargetId, setDropTargetId] = useState<string | null>(null);
    const [movingId, setMovingId] = useState<string | null>(null);

    const saveOrder = async (newOrder: string[]) => {
        const res = await fetch('/api/openclaw/agents/order', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentIds: newOrder }),
        });
        if (res.ok) router.refresh();
    };

    const handleMove = async (agentId: string, dir: -1 | 1) => {
        const agentIds = agents.map((a) => a.id);
        const newOrder = moveInOrder(agentIds, agentId, dir);
        if (newOrder.join(',') === agentIds.join(',')) return;
        setMovingId(agentId);
        await saveOrder(newOrder);
        setMovingId(null);
    };

    const handleDragStart = (e: React.DragEvent, agentId: string, wrapperEl: HTMLDivElement | null) => {
        setDraggingId(agentId);
        e.dataTransfer.setData('text/plain', agentId);
        e.dataTransfer.effectAllowed = 'move';
        if (wrapperEl) {
            e.dataTransfer.setDragImage(wrapperEl, 20, 20);
        }
        wrapperEl?.classList.add('agent-card-dragging');
    };

    const handleDragEnd = (e: React.DragEvent) => {
        setDraggingId(null);
        setDropTargetId(null);
        (e.currentTarget as HTMLElement).closest('.agent-card-sortable')?.classList.remove('agent-card-dragging');
    };

    const handleDragOver = (e: React.DragEvent, dropAgentId: string) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDropTargetId(dropAgentId);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        const related = e.relatedTarget as Node | null;
        if (!related || !(e.currentTarget as HTMLElement).contains(related)) {
            setDropTargetId(null);
        }
    };

    const handleDrop = async (e: React.DragEvent, dropAgentId: string) => {
        e.preventDefault();
        setDropTargetId(null);
        (e.currentTarget as HTMLElement).closest('.agent-card-sortable')?.classList.remove('agent-card-dragging');
        const dragId = e.dataTransfer.getData('text/plain');
        if (!dragId || dragId === dropAgentId) return;
        const agentIds = agents.map((a) => a.id);
        const newOrder = reorderIds(agentIds, dragId, dropAgentId);
        if (newOrder.join(',') === agentIds.join(',')) return;
        await saveOrder(newOrder);
    };

    if (agents.length === 0) {
        return (
            <div className="agents-grid">
                <div className="empty-state">
                    <p>No agents found in <code>~/.openclaw/agents</code></p>
                </div>
            </div>
        );
    }

    return (
        <div className="agents-grid">
            {agents.map((agent) => (
                <SortableAgentRow
                    key={agent.id}
                    agent={agent}
                    index={agents.findIndex((a) => a.id === agent.id)}
                    total={agents.length}
                    isDropTarget={dropTargetId === agent.id && agent.id !== draggingId}
                    isMoving={movingId === agent.id}
                    onMove={handleMove}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                />
            ))}
        </div>
    );
}

interface SortableAgentRowProps {
    agent: Agent;
    index: number;
    total: number;
    isDropTarget: boolean;
    isMoving: boolean;
    onMove: (agentId: string, dir: -1 | 1) => void;
    onDragStart: (e: React.DragEvent, agentId: string, wrapperEl: HTMLDivElement | null) => void;
    onDragEnd: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent, dropAgentId: string) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent, dropAgentId: string) => void;
}

function SortableAgentRow({
    agent,
    index,
    total,
    isDropTarget,
    isMoving,
    onMove,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDragLeave,
    onDrop,
}: SortableAgentRowProps) {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const canMoveUp = index > 0;
    const canMoveDown = index < total - 1;

    return (
        <div
            ref={wrapperRef}
            className={`agent-card-sortable ${isDropTarget ? 'agent-card-drop-target' : ''}`}
            onDragOver={(e) => onDragOver(e, agent.id)}
            onDragLeave={onDragLeave}
            onDrop={(e) => onDrop(e, agent.id)}
        >
            <div className="agent-card-reorder">
                <div
                    className="agent-card-drag-handle"
                    draggable
                    onDragStart={(e) => onDragStart(e, agent.id, wrapperRef.current)}
                    onDragEnd={onDragEnd}
                    title="Drag to reorder"
                    aria-label={`Drag to reorder ${agent.name}`}
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="9" cy="6" r="1.5" />
                        <circle cx="9" cy="12" r="1.5" />
                        <circle cx="9" cy="18" r="1.5" />
                        <circle cx="15" cy="6" r="1.5" />
                        <circle cx="15" cy="12" r="1.5" />
                        <circle cx="15" cy="18" r="1.5" />
                    </svg>
                </div>
                <div className="agent-card-move-buttons">
                    <button
                        type="button"
                        className="agent-card-move-btn"
                        onClick={() => onMove(agent.id, -1)}
                        disabled={!canMoveUp || isMoving}
                        title="Move up"
                        aria-label={`Move ${agent.name} up`}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 15l-6-6-6 6" />
                        </svg>
                    </button>
                    <button
                        type="button"
                        className="agent-card-move-btn"
                        onClick={() => onMove(agent.id, 1)}
                        disabled={!canMoveDown || isMoving}
                        title="Move down"
                        aria-label={`Move ${agent.name} down`}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M6 9l6 6 6-6" />
                        </svg>
                    </button>
                </div>
            </div>
            <div className="agent-card-wrap">
                <AgentCard agent={agent} />
            </div>
        </div>
    );
}
