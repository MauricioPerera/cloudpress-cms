import { runScheduledWork } from "../functions/_scheduler.js";

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduledWork(env).then((result) => console.log("cloudpress scheduler", JSON.stringify(result))));
  },
};
