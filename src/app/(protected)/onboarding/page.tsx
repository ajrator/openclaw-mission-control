import { Suspense } from 'react';
import { OnboardingWizard } from '@/components/OnboardingWizard';

export default function OnboardingPage() {
    return (
        <div className="onboarding-page">
            <Suspense fallback={<p className="onboarding-desc">Loading…</p>}>
                <OnboardingWizard />
            </Suspense>
        </div>
    );
}
