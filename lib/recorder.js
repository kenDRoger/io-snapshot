import SuperJSON from 'superjson';

function getPort() {
    if (typeof process !== 'undefined' && process.env.IOSNAP_DAEMON_PORT) {
        return parseInt(process.env.IOSNAP_DAEMON_PORT, 10);
    }
    if (typeof window !== 'undefined') {
        return window.IOSNAP_DAEMON_PORT || 9444;
    }
    return 9444;
}

export function record(fn, fnName) {
    return new Proxy(fn, {
        async apply(target, thisArg, args) {
            const result = await Reflect.apply(target, thisArg, args);

            const snapshot = {
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
                console.warn(`[io-snapshot] Failed to send telemetry: ${error.message}`);
            });

            return result;
        }
    });
}
