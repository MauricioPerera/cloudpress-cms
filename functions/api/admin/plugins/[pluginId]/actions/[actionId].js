import { executeAction } from "../../../../../_plugins/execute.js";
export async function onRequestPost({ request, env, params }) { return executeAction({ request, env, pluginId: String(params.pluginId || ""), actionId: String(params.actionId || "") }); }
