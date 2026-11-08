// Ported verbatim from lib/java/proxy.js (file copied; template-literal interior byte-for-byte).
// Java-side proxy source injected into target projects by src/adapter/java/index.ts.
export const JAVA_PROXY_CODE = `
// IOSnapshotProxy START
class IOSnapshotProxy {
    private static final String DAEMON_HOST;
    private static final int DAEMON_PORT;
    private static final java.net.http.HttpClient CLIENT;
    
    static {
        DAEMON_HOST = System.getenv("IOSNAP_DAEMON_HOST") != null 
            ? System.getenv("IOSNAP_DAEMON_HOST") : "localhost";
        String portStr = System.getenv("IOSNAP_DAEMON_PORT");
        DAEMON_PORT = portStr != null ? Integer.parseInt(portStr) : 9444;
        CLIENT = java.net.http.HttpClient.newBuilder()
            .connectTimeout(java.time.Duration.ofSeconds(5))
            .build();
    }
    public static void __snap_record(String fnName, Object[] args, Object result) {
        try {
            String json = toJson(fnName, args, result);
            String url = "http://" + DAEMON_HOST + ":" + DAEMON_PORT + "/telemetry";
            
            java.net.http.HttpRequest request = java.net.http.HttpRequest.newBuilder()
                .uri(java.net.URI.create(url))
                .header("Content-Type", "application/json")
                .POST(java.net.http.HttpRequest.BodyPublishers.ofString(json))
                .build();
            
            CLIENT.send(request, java.net.http.HttpResponse.BodyHandlers.discarding());
        } catch (Exception e) {
            System.err.println("[io-snapshot] " + e.getMessage());
        }
    }
    private static String toJson(String fnName, Object[] args, Object result) {
        StringBuilder sb = new StringBuilder();
        sb.append("{");
        sb.append("\\"fnName\\":\\"").append(fnName).append("\\",");
        sb.append("\\"args\\":").append(toJsonArray(args)).append(",");
        sb.append("\\"result\\":").append(toJsonValue(result)).append(",");
        sb.append("\\"at\\":\\"").append(java.time.Instant.now().toString()).append("\\"");
        sb.append("}");
        return sb.toString();
    }
    private static String toJsonArray(Object[] arr) {
        if (arr == null) return "null";
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < arr.length; i++) {
            if (i > 0) sb.append(",");
            sb.append(toJsonValue(arr[i]));
        }
        sb.append("]");
        return sb.toString();
    }
    private static String toJsonValue(Object obj) {
        if (obj == null) return "null";
        if (obj instanceof String) return "\\"" + escape((String) obj) + "\\"";
        if (obj instanceof Number || obj instanceof Boolean) return obj.toString();
        if (obj instanceof java.util.List) {
            return toJsonArray(((java.util.List<?>) obj).toArray());
        }
        if (obj instanceof java.util.Map) {
            return toJsonObject((java.util.Map<?, ?>) obj);
        }
        return "\\"" + escape(obj.toString()) + "\\"";
    }
    private static String toJsonObject(java.util.Map<?, ?> map) {
        StringBuilder sb = new StringBuilder("{");
        int i = 0;
        for (var e : map.entrySet()) {
            if (i > 0) sb.append(",");
            sb.append("\\"").append(e.getKey()).append("\\":");
            sb.append(toJsonValue(e.getValue()));
            i++;
        }
        sb.append("}");
        return sb.toString();
    }
    private static String escape(String s) {
        if (s == null) return "";
        return s.replace("\\\\", "\\\\\\\\")
                .replace("\\"", "\\\\\\"")
                .replace("\\n", "\\\\n")
                .replace("\\r", "\\\\r")
                .replace("\\t", "\\\\t");
    }
}
// IOSnapshotProxy END
`;
