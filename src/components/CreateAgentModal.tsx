"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AddModelForm, type AvailableToAdd } from '@/components/AddModelForm';
import { useAlertConfirm } from '@/components/AlertConfirmProvider';

export function CreateAgentModal({
    availableModels,
    onCreated,
    open: controlledOpen,
    onOpenChange
}: {
    availableModels: string[];
    onCreated?: (id: string, name?: string) => void;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}) {
    const [internalOpen, setInternalOpen] = useState(false);
    const isControlled = controlledOpen !== undefined && onOpenChange !== undefined;
    const isOpen = isControlled ? controlledOpen : internalOpen;
    const setIsOpen = isControlled ? (v: boolean) => onOpenChange?.(v) : setInternalOpen;
    const [name, setName] = useState('');
    const [model, setModel] = useState(availableModels[0] || '');
    const [fallbacks, setFallbacks] = useState<string[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [view, setView] = useState<'create' | 'addModel'>('create');
    const [availableToAdd, setAvailableToAdd] = useState<AvailableToAdd>([]);
    const router = useRouter();
    const { showAlert } = useAlertConfirm();

    const handleOpen = () => setIsOpen(true);
    const handleClose = () => {
        setIsOpen(false);
        setName('');
        setModel(availableModels[0] || '');
        setFallbacks([]);
        setView('create');
    };

    const handleAddFallback = () => {
        setFallbacks([...fallbacks, availableModels[0] || '']);
    };

    const handleUpdateFallback = (index: number, val: string) => {
        const newF = [...fallbacks];
        newF[index] = val;
        setFallbacks(newF);
    };

    const handleRemoveFallback = (index: number) => {
        setFallbacks(fallbacks.filter((_, i) => i !== index));
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        try {
            const res = await fetch('/api/openclaw/agent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, model, fallbacks })
            });
            if (res.ok) {
                const data = await res.json().catch(() => ({}));
                const id = data?.id;
                handleClose();
                router.refresh();
                if (typeof id === 'string') onCreated?.(id, name?.trim() || undefined);
            } else {
                showAlert('Error creating agent');
            }
        } finally {
            setIsSaving(false);
        }
    };

    const openAddModel = async () => {
        try {
            const res = await fetch('/api/openclaw/models');
            const data = await res.json().catch(() => ({}));
            setAvailableToAdd(res.ok ? (data.availableToAdd ?? []) : []);
        } catch {
            setAvailableToAdd([]);
        }
        setView('addModel');
    };

    return (
        <>
            {!isControlled && (
            <button className="btn-primary" onClick={handleOpen}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                Create Agent
            </button>
            )}

            {isOpen && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <div className="modal-header">
                            <h2 className="modal-title">{view === 'create' ? 'Create New Agent' : 'Add Model'}</h2>
                            <button className="modal-close" onClick={handleClose}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                            </button>
                        </div>

                        {view === 'create' && (
                            <form onSubmit={handleSave} className="modal-body">
                                <div className="form-group">
                                    <label className="form-label">Agent Name</label>
                                    <input
                                        className="form-input"
                                        type="text"
                                        placeholder="e.g. Researcher"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        required
                                        autoFocus
                                    />
                                </div>

                                <div className="form-group">
                                    <div className="fallbacks-header">
                                        <label className="form-label">Primary Model</label>
                                        <button type="button" className="btn-add-fallback" onClick={openAddModel}>
                                            + Add new model
                                        </button>
                                    </div>
                                    <select
                                        className="form-select"
                                        value={model}
                                        onChange={(e) => setModel(e.target.value)}
                                        required
                                    >
                                        {availableModels.map(m => <option key={m} value={m}>{m}</option>)}
                                    </select>
                                </div>

                                <div className="form-group form-group-fallbacks">
                                    <div className="fallbacks-header">
                                        <label className="form-label">Fallback Models</label>
                                        <button type="button" className="btn-add-fallback" onClick={handleAddFallback}>
                                            + Add
                                        </button>
                                    </div>

                                    {fallbacks.length === 0 && (
                                        <div className="fallback-empty">No fallbacks selected. Global defaults will be inherited.</div>
                                    )}

                                    {fallbacks.map((fb, index) => (
                                        <div key={index} className="fallback-row">
                                            <span className="fallback-number">{index + 1}.</span>
                                            <select
                                                className="form-select"
                                                value={fb}
                                                onChange={(e) => handleUpdateFallback(index, e.target.value)}
                                            >
                                                {availableModels.map(m => <option key={m} value={m}>{m}</option>)}
                                            </select>
                                            <button type="button" className="btn-remove-fallback" onClick={() => handleRemoveFallback(index)}>
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                            </button>
                                        </div>
                                    ))}
                                </div>

                                <div className="modal-footer">
                                    <button type="button" className="btn-secondary" onClick={handleClose}>Cancel</button>
                                    <button type="submit" className="btn-primary" disabled={isSaving || !name}>
                                        {isSaving ? 'Creating...' : 'Create Agent'}
                                    </button>
                                </div>
                            </form>
                        )}

                        {view === 'addModel' && (
                            <AddModelForm
                                availableToAdd={availableToAdd}
                                backLabel="Back"
                                onSuccess={(newModelId) => {
                                    if (newModelId) setModel(newModelId);
                                    setView('create');
                                    router.refresh();
                                }}
                                onCancel={() => setView('create')}
                            />
                        )}
                    </div>
                </div>
            )}
        </>
    );
}
