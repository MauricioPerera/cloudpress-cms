const LOOPBACK_ORIGIN = "http://127.0.0.1:9463";

const failed = (error_code) => ({ status: "failed", operation: "cloudpress_irreversible_action", error_code });

export function createCloudPressLsfaBroker() {
  return {
    async request(request, { signal, origin }) {
      try {
        const health = await fetch(`${LOOPBACK_ORIGIN}/health`, { method: "GET", mode: "cors", credentials: "omit", signal });
        if (!health.ok) return failed("broker_unavailable");
      } catch { return failed("broker_unavailable"); }

      let prepared;
      try {
        const response = await fetch("/api/admin/approvals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request.agentInput), signal });
        prepared = await response.json();
        if (!response.ok) return failed("approval_preparation_failed");
      } catch { return failed("approval_preparation_failed"); }

      try {
        const executeUrl = new URL(`/api/admin/approvals/${encodeURIComponent(prepared.requestId)}/execute`, location.origin).href;
        const response = await fetch(`${LOOPBACK_ORIGIN}/v1/cloudpress/approvals`, {
          method: "POST",
          mode: "cors",
          credentials: "omit",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ protocol: "lsfa", version: "0.2", origin, request: { request_id: prepared.requestId, operation: request.intent.operation, purpose: request.intent.purpose, risk: prepared.risk, expires_at: prepared.expiresAt, summary: prepared.summary }, execute: { url: executeUrl, token: prepared.executionToken } }),
          signal,
        });
        if (!response.ok) return failed("broker_rejected_request");
        return await response.json();
      } catch { return failed("broker_unavailable"); }
    },
  };
}
