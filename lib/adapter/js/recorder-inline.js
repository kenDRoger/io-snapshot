export function getInlineRecorderCode() {
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
        async apply(target, thisArg, args) {
            var result = Reflect.apply(target, thisArg, args);
            var snapshot = {
            fnName: fnName,
            args: args,
            result: result,
            at: new Date().toISOString()
            };
            var SJ = _snap_getSuperJSON();
            fetch('http://localhost:' + port + '/telemetry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: SJ.stringify(snapshot)
            }).catch(function(err) { 
                    console.warn('[io-snapshot] Telemetry failed:', err.message); 
                });
            return result;
        }
        });
    }
    window._snap_record = _snap_record;
})();
`.trim();
}
