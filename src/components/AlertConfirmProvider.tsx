'use client';

import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

type AlertState = { message: string } | null;
type ConfirmState = {
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
    warning?: boolean;
} | null;

interface AlertConfirmContextType {
    showAlert: (message: string) => void;
    confirmDialog: (options: {
        message: string;
        confirmLabel?: string;
        cancelLabel?: string;
        danger?: boolean;
        warning?: boolean;
    }) => Promise<boolean>;
}

const AlertConfirmContext = createContext<AlertConfirmContextType | undefined>(undefined);

export function AlertConfirmProvider({ children }: { children: React.ReactNode }) {
    const [alertState, setAlertState] = useState<AlertState>(null);
    const [confirmState, setConfirmState] = useState<ConfirmState>(null);
    const confirmResolveRef = useRef<((value: boolean) => void) | null>(null);

    const showAlert = useCallback((message: string) => {
        setAlertState({ message });
    }, []);

    const confirmDialog = useCallback(
        (options: { message: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean; warning?: boolean }) => {
            return new Promise<boolean>((resolve) => {
                confirmResolveRef.current = resolve;
                setConfirmState({
                    message: options.message,
                    confirmLabel: options.confirmLabel ?? 'Confirm',
                    cancelLabel: options.cancelLabel ?? 'Cancel',
                    danger: options.danger ?? false,
                    warning: options.warning ?? false,
                });
            });
        },
        []
    );

    const closeAlert = useCallback(() => setAlertState(null), []);

    const closeConfirm = useCallback((value: boolean) => {
        confirmResolveRef.current?.(value);
        confirmResolveRef.current = null;
        setConfirmState(null);
    }, []);

    return (
        <AlertConfirmContext.Provider value={{ showAlert, confirmDialog }}>
            {children}
            {alertState && (
                <div
                    className="modal-backdrop"
                    onClick={closeAlert}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="alert-title"
                >
                    <div className="modal alert-confirm-modal" onClick={(e) => e.stopPropagation()}>
                        <h2 id="alert-title" className="modal-title">
                            Notice
                        </h2>
                        <p className="alert-confirm-message">{alertState.message}</p>
                        <div className="modal-actions">
                            <button type="button" className="btn-primary" onClick={closeAlert}>
                                OK
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {confirmState && (
                <div
                    className="modal-backdrop"
                    onClick={() => closeConfirm(false)}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="confirm-title"
                >
                    <div className="modal alert-confirm-modal" onClick={(e) => e.stopPropagation()}>
                        <h2 id="confirm-title" className="modal-title">
                            Confirm
                        </h2>
                        <p className="alert-confirm-message">{confirmState.message}</p>
                        <div className="modal-actions">
                            <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => closeConfirm(false)}
                            >
                                {confirmState.cancelLabel}
                            </button>
                            <button
                                type="button"
                                className={confirmState.danger ? 'btn-danger' : confirmState.warning ? 'btn-warning' : 'btn-primary'}
                                onClick={() => closeConfirm(true)}
                            >
                                {confirmState.confirmLabel}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </AlertConfirmContext.Provider>
    );
}

export function useAlertConfirm() {
    const context = useContext(AlertConfirmContext);
    if (context === undefined) {
        throw new Error('useAlertConfirm must be used within an AlertConfirmProvider');
    }
    return context;
}
