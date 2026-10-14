import { handleRequest } from "./routing.js";

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};
