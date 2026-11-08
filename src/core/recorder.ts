import SuperJSON from 'superjson';

/** Runtime port resolution.
 *  In the CLI (node): env `IOSNAP_DAEMON_PORT`, else 9444.
 *  In the browser (recorder is injected inline): `window.IOSNAP_DAEMON_PORT`, else 9444. */
function getPort(): number {
    if (typeof process !== 'undefined' && process.env.IOSNAP_DAEMON_PORT) {
        return parseInt(process.env.IOSNAP_DAEMON_PORT, 10);
    }
    if (typeof (globalThis as unknown as { window?: unknown }).window !== 'undefined') {
        const port = (globalThis as unknown as { window?: { IOSNAP_DAEMON_PORT?: number } }).window?.IOSNAP_DAEMON_PORT;
        return port || 9444;
    }
    return 9444;
}

export interface SphereSnapshot {
    fnName: string;
    args: unknown[];
    result: unknown;
    at: string;
    lang?: string;
}

/** Wraps `fn` in a Proxy that posts a SuperJSON snapshot of every call to the local daemon.
 *  Source of truth: lib/core/recorder.js — semantics preserved 1:1. */
export function record<T extends (...args: never[]) => unknown>(fn: T, fnName: string): T {
    return new Proxy(fn, {
        async apply(target, thisArg, args) {
            const result = await Reflect.apply(target, thisArg, args);

            const snapshot: SphereSnapshot = {
                fnName,
                args,
                result,
                at: new Date().toISOString()
            };

            const port = getPort();

            fetch(`http://localhost:${port}/telemetry`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: SuperJSON.stringify(snapshot)
            }).catch((error) => {
                console.warn(`[io-snapshot] Failed to send telemetry: ${(error as Error).message}`);
            });

            return result;
        }
    });
}
