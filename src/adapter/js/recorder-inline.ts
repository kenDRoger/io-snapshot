/** The inline browser recorder source, interpolated with the daemon port at injection time.
 *  Source of truth: lib/adapter/js/recorder-inline.js (file copied; template interior byte-for-byte). */
export function getInlineRecorderCode(): string {
    const port = process.env.IOSNAP_DAEMON_PORT || 9444;

    return `
(function() {
    var port = ${port};
    var _snap_SuperJSON = null;
    function _snap_getSuperJSON() {
        if (_snap_SuperJSON) return _snap_SuperJSON;
        try {
        _snap_SuperJSON = { stringify: JSON.stringify, parse: JSON.parse };
        return _snap_SuperJSON;
        } catch (e) {
        return { stringify: JSON.stringify, parse: JSON.parse };
        }
    }
    function _snap_record(fn, fnName) {
        return new Proxy(fn, {
        apply(target, thisArg, args) {
            var result = Reflect.apply(target, thisArg, args);
            var snapshot = {
            fnName: fnName,
            args: args,
            result: result,
            at: new Date().toISOString()
            };
            fetch('http://localhost:' + port + '/telemetry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: _snap_getSuperJSON().stringify(snapshot)
            }).catch(function(error) {
            console.warn('[io-snapshot] Failed to send telemetry: ' + error.message);
            });
            return result;
        }
        });
    }
    if (typeof window !== 'undefined') {
        window._snap_record = _snap_record;
    } else {
        (typeof globalThis !== 'undefined' ? globalThis : self)._snap_record = _snap_record;
    }
})();
`;
}
