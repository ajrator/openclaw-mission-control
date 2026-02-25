'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AddModelForm, type AvailableToAdd } from '@/components/AddModelForm';

export type { AvailableToAdd } from '@/components/AddModelForm';

export function AddModelModal({
    availableToAdd,
    onAdded,
    open: controlledOpen,
    onOpenChange,
}: {
    availableToAdd: AvailableToAdd;
    onAdded?: (newModelId?: string) => void;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}) {
    const [internalOpen, setInternalOpen] = useState(false);
    const isControlled = controlledOpen !== undefined && onOpenChange !== undefined;
    const isOpen = isControlled ? controlledOpen : internalOpen;
    const router = useRouter();

    const handleOpen = () => {
        if (!isControlled) setInternalOpen(true);
    };

    const handleClose = () => {
        if (isControlled) onOpenChange?.(false);
        else setInternalOpen(false);
    };

    return (
        <>
            {!isControlled && (
                <button className="btn-primary" onClick={handleOpen}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    Add model
                </button>
            )}

            {isOpen && (
                <div className="modal-overlay" onClick={handleClose}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2 className="modal-title">Add Model</h2>
                            <button className="modal-close" onClick={handleClose}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        </div>
                        <AddModelForm
                            availableToAdd={availableToAdd}
                            onSuccess={(newModelId) => {
                                onAdded?.(newModelId);
                                handleClose();
                                router.refresh();
                            }}
                            onCancel={handleClose}
                        />
                    </div>
                </div>
            )}
        </>
    );
}
