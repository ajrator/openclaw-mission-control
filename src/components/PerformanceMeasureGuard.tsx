'use client';

import { useEffect } from 'react';

const NEGATIVE_TIMESTAMP_RE = /negative time stamp/i;

type PatchedPerformance = Performance & {
  __mcMeasurePatched?: boolean;
  __mcOriginalMeasure?: Performance['measure'];
};

/**
 * Guards against browser/runtime timing glitches that can throw from performance.measure
 * (observed in dev with Next.js overlays when a computed timestamp is negative).
 */
export function PerformanceMeasureGuard() {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.performance?.measure !== 'function') return;

    const perf = window.performance as PatchedPerformance;
    if (perf.__mcMeasurePatched) return;

    const original = perf.measure.bind(perf) as Performance['measure'];
    perf.__mcOriginalMeasure = original;

    const patched: Performance['measure'] = ((...args: Parameters<Performance['measure']>) => {
      try {
        return original(...args);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!NEGATIVE_TIMESTAMP_RE.test(message)) throw err;

        // Fall back to a simple mark-less measure so app rendering doesn't crash in dev.
        try {
          const [name] = args;
          return original(name);
        } catch {
          return undefined as unknown as PerformanceMeasure;
        }
      }
    }) as Performance['measure'];

    Object.defineProperty(perf, 'measure', {
      configurable: true,
      writable: true,
      value: patched,
    });
    perf.__mcMeasurePatched = true;

    return () => {
      if (!perf.__mcMeasurePatched || !perf.__mcOriginalMeasure) return;
      Object.defineProperty(perf, 'measure', {
        configurable: true,
        writable: true,
        value: perf.__mcOriginalMeasure,
      });
      perf.__mcMeasurePatched = false;
    };
  }, []);

  return null;
}

