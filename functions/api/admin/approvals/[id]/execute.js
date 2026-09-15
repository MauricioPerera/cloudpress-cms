import { executeApproval } from "../../../../_approvals.js";

export async function onRequestPost({ request, env, params }) {
  return executeApproval(env, params.id, request.headers.get("x-cloudpress-approval-token") || "");
}
