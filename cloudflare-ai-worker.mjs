const MAX_BODY_BYTES = 30_000;

function unauthorized() {
  return Response.json({ error: "Não autorizado." }, { status: 401 });
}

function authorized(request, env) {
  const expected = env.APP_SHARED_SECRET || "";
  const supplied = request.headers.get("Authorization") || "";
  const actual = supplied.startsWith("Bearer ") ? supplied.slice(7) : "";
  if (!expected || actual.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  return difference === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!authorized(request, env)) return unauthorized();

    if (url.pathname === "/health" && request.method === "GET") {
      return Response.json({ available: !!env.AI, model: env.CLOUDFLARE_AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast" }, { headers: { "Cache-Control": "no-store" } });
    }

    if (url.pathname !== "/v1/draft" || request.method !== "POST") {
      return Response.json({ error: "Rota não encontrada." }, { status: 404 });
    }

    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return Response.json({ error: "A solicitação ultrapassa o limite de 30 KB." }, { status: 413 });
    }

    let body;
    try { body = JSON.parse(rawBody || "{}"); }
    catch { return Response.json({ error: "O conteúdo enviado não é um JSON válido." }, { status: 400 }); }

    if (!Array.isArray(body.messages) || !body.schema || typeof body.schema !== "object") {
      return Response.json({ error: "A solicitação de geração está incompleta." }, { status: 400 });
    }

    const model = env.CLOUDFLARE_AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
    try {
      const result = await env.AI.run(model, {
        messages: body.messages,
        temperature: 0,
        max_tokens: 1600,
        response_format: { type: "json_schema", json_schema: body.schema }
      });
      const output = result && (result.response || result.output_text);
      const response = typeof output === "string" ? output : output && typeof output === "object" ? JSON.stringify(output) : "";
      if (!response) throw new Error("Workers AI não retornou conteúdo JSON.");
      return Response.json({ response, model }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return Response.json({ error: error.message || "Falha na geração do Workers AI." }, { status: 502, headers: { "Cache-Control": "no-store" } });
    }
  }
};
