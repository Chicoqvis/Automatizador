import { dailyAiQuotaError } from "./ai-quota.mjs";
import { quotaSummary, measuredAiUsage, trackDailyUsage } from './daily-usage.mjs';
import { memoryContent, selectAccountMemory, memoryInstruction, memorySources } from "./account-memory.mjs";
import { validateSavedDraft, findSimilarIssues, validateHistoryEntry, fieldRefinementInstruction } from "./issue-workflow.mjs";
import { readAttachment, uploadGithubAttachment } from "./github-attachments.mjs";
import { DRAFT_SYSTEM_PROMPT, formatIssueTitle, formatDraftTopics } from "./draft-prompt.mjs";
const MODEL_DEFAULT = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const SESSION_TTL = 12 * 60 * 60;
const MAX_BODY = 30_000;
const URGENCY = [
  "Crítico (Impacto severo no funcionamento do hospital (paralisação, erro grave))",
  "Alto (Impacto grande, mas não impede totalmente as operações)",
  "Médio (Melhoria importante, mas não urgente)",
  "Baixo (Melhoria pequena ou ajuste estético)"
];
const MOTIVATION = [
  "Redução de custo", "Aumento de receita", "Redução de erros operacionais",
  "Melhoria na experiência do usuário", "Atendimento a exigências regulatórias", "Outras [Descreva abaixo]"
];
const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" }, requester: { type: "string" }, units: { type: "string" },
    frequency: { type: "string" }, problem: { type: "string" }, description: { type: "string" },
    impacts: { type: "string" }, today: { type: "string" }, nonimplementation: { type: "string" },
    motivation: { type: "string", enum: ["", ...MOTIVATION] }, otherMotivation: { type: "string" },
    urgency: { type: "string", enum: ["", ...URGENCY] }, classification: { type: "string", enum: ["bug", "requisito"] },
    questions: { type: "array", items: { type: "string" }, maxItems: 1 }
  },
  required: ["title", "requester", "units", "frequency", "problem", "description", "impacts", "today", "nonimplementation", "motivation", "otherMotivation", "urgency", "classification", "questions"],
  additionalProperties: false
};
const PROJECT_QUERY = `query($owner:String!, $repo:String!) {
  repository(owner:$owner, name:$repo) {
    projectsV2(first:100) { nodes { ...ProjectInfo } }
    owner { __typename ... on Organization { projectsV2(first:100) { nodes { ...ProjectInfo } } } ... on User { projectsV2(first:100) { nodes { ...ProjectInfo } } } }
  }
}
fragment ProjectInfo on ProjectV2 { id title number fields(first:50) { nodes { __typename ... on ProjectV2SingleSelectField { id name options { id name } } } } }`;

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}
function fail(message, status = 400) { return Object.assign(new Error(message), { status }); }
function clean(value) { return typeof value === "string" ? value.trim() : ""; }
function validUsername(value) { return typeof value === "string" && /^[a-zA-Z0-9._-]{3,32}$/.test(value); }
function validPassword(value) { return typeof value === "string" && value.length > 0 && value.length <= 128; }
function safeUser(user) { return { id: user.id, username: user.username, role: user.role, active: !!user.active, createdAt: user.created_at }; }
function cookies(header = "") {
  return Object.fromEntries(header.split(";").map((part) => part.trim().split(/=(.*)/s).slice(0, 2))
    .filter(([key, value]) => key && value !== undefined).map(([key, value]) => [key, decodeURIComponent(value)]));
}
function cookie(value, maxAge) {
  return `automacao_session=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}; Secure`;
}
function withCookie(response, value, maxAge) {
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", cookie(value, maxAge));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
async function readBody(request,maxBytes=MAX_BODY) {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw fail("A descrição ultrapassa o limite de 30 KB.", 413);
  try { return JSON.parse(text || "{}"); }
  catch { throw fail("O conteúdo enviado não é um JSON válido."); }
}
function randomToken(bytes = 32) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function hex(bytes) { return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join(""); }
async function digest(value) { return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))); }
function toBytes(value) { return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0)); }
function toB64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
async function passwordHash(password, salt = randomToken(16)) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: toBytes(salt), iterations: 100_000, hash: "SHA-256" }, key, 256);
  return { salt, hash: hex(bits) };
}
async function verifyPassword(password, user) {
  if (!user || !user.password_salt || !user.password_hash) return false;
  const candidate = await passwordHash(password, user.password_salt);
  return candidate.hash === user.password_hash;
}
async function encryptSecret(value, env) {
  if (!env.GITHUB_TOKEN_ENCRYPTION_KEY) throw fail("Configure GITHUB_TOKEN_ENCRYPTION_KEY nos segredos do Worker para salvar tokens GitHub.", 503);
  let raw;
  try { raw = toBytes(env.GITHUB_TOKEN_ENCRYPTION_KEY); } catch { throw fail("GITHUB_TOKEN_ENCRYPTION_KEY precisa ser uma chave Base64URL válida de 32 bytes.", 503); }
  if (raw.byteLength !== 32) throw fail("GITHUB_TOKEN_ENCRYPTION_KEY precisa representar exatamente 32 bytes.", 503);
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
  return toB64(iv) + "." + toB64(encrypted);
}
async function decryptSecret(value, env) {
  if (!value || !env.GITHUB_TOKEN_ENCRYPTION_KEY) throw fail("Configure GITHUB_TOKEN_ENCRYPTION_KEY para acessar a conexão GitHub.", 503);
  const [ivPart, encryptedPart] = value.split(".");
  const raw = toBytes(env.GITHUB_TOKEN_ENCRYPTION_KEY);
  if (raw.byteLength !== 32 || !encryptedPart) throw fail("A chave de criptografia GitHub está inválida.", 503);
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  try { return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: toBytes(ivPart) }, key, toBytes(encryptedPart))); }
  catch { throw fail("Não foi possível abrir a conexão GitHub. Confira GITHUB_TOKEN_ENCRYPTION_KEY.", 503); }
}
async function sessionFor(request, env) {
  const token = cookies(request.headers.get("Cookie") || "").automacao_session;
  if (!token) return null;
  const row = await env.DB.prepare(`SELECT s.token_hash,s.expires_at,u.id,u.username,u.role,u.active,u.created_at
    FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`).bind(await digest(token), Date.now()).first();
  return row ? { token, tokenHash: row.token_hash, expiresAt: row.expires_at, user: row } : null;
}
async function createSession(env, userId) {
  const token = randomToken();
  const expires = Date.now() + SESSION_TTL * 1000;
  await env.DB.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").bind(await digest(token), userId, expires).run();
  return token;
}
async function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}
function githubOAuthConfigured(env) { return !!(env.GITHUB_APP_CLIENT_ID && env.GITHUB_APP_CLIENT_SECRET && env.GITHUB_APP_CALLBACK_URL); }
async function githubApi(path, token, init = {}) {
  return fetch("https://api.github.com" + path, {
    ...init,
    headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + token, "X-GitHub-Api-Version": "2026-03-10", "User-Agent": "Automatizador-de-issues", ...(init.headers || {}) }
  });
}
async function githubError(response) {
  const data = await response.json().catch(() => ({}));
  return data.message || "GitHub respondeu com HTTP " + response.status + ".";
}
async function githubIdentity(env, userId) {
  const row = await env.DB.prepare("SELECT * FROM github_identities WHERE user_id=?").bind(userId).first();
  if (!row) return null;
  if (row.expires_at && row.expires_at <= Date.now() + 5 * 60 * 1000) {
    if (!row.refresh_cipher) {
      await env.DB.prepare("DELETE FROM github_identities WHERE user_id=?").bind(userId).run();
      await env.DB.prepare("DELETE FROM github_connections WHERE user_id=?").bind(userId).run();
      throw fail("A autorização do GitHub expirou. Conecte sua conta novamente.", 401);
    }
    const refreshToken = await decryptSecret(row.refresh_cipher, env);
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: env.GITHUB_APP_CLIENT_ID, client_secret: env.GITHUB_APP_CLIENT_SECRET, grant_type: "refresh_token", refresh_token: refreshToken })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) throw fail("Não foi possível renovar a autorização GitHub. Conecte sua conta novamente.", 401);
    const expiresAt = data.expires_at ? Date.parse(data.expires_at) : Date.now() + Number(data.expires_in || 0) * 1000;
    await env.DB.prepare("UPDATE github_identities SET token_cipher=?,refresh_cipher=?,expires_at=? WHERE user_id=?")
      .bind(await encryptSecret(data.access_token, env), data.refresh_token ? await encryptSecret(data.refresh_token, env) : null, expiresAt, userId).run();
    const updated = await env.DB.prepare("SELECT * FROM github_identities WHERE user_id=?").bind(userId).first();
    return { token: data.access_token, login: updated.login };
  }
  return { token: await decryptSecret(row.token_cipher, env), login: row.login };
}
async function githubConnection(env, userId) {
  const row = await env.DB.prepare("SELECT * FROM github_connections WHERE user_id=?").bind(userId).first();
  if (!row) return null;
  let token = await decryptSecret(row.token_cipher, env);
  if (row.github_user) {
    const identity = await githubIdentity(env, userId);
    if (!identity) throw fail("A autorização do GitHub expirou. Conecte sua conta novamente.", 401);
    token = identity.token;
  }
  return { owner: row.owner, repo: row.repo, token, repositoryUrl: row.repository_url, githubUser: row.github_user || "" };
}
async function connectGithub(env, body, userId) {
  const target = clean(body.repository);
  const suppliedToken = clean(body.token);
  const match = target.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match) throw fail("Informe o repositório no formato organização/repositório.");
  const identity = suppliedToken ? null : await githubIdentity(env, userId);
  const token = suppliedToken || identity?.token || "";
  if (!token) throw fail("Informe um token de acesso do GitHub.");
  const [owner, repo] = match.slice(1);
  const response = await githubApi("/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo), token);
  if (!response.ok) {
    const detail = await githubError(response);
    if (response.status === 401) throw fail("Token inválido ou expirado. Gere outro token e tente novamente.", 401);
    if (response.status === 403) throw fail("Acesso negado. Confira as permissões Issues: Read and write. " + detail, 403);
    if (response.status === 404) throw fail("GitHub respondeu Not Found. Confira organização/repositório e o acesso do token.", 404);
    throw fail("Não foi possível validar o repositório. " + detail, 502);
  }
  const repository = await response.json();
  await env.DB.prepare(`INSERT INTO github_connections(user_id,owner,repo,repository_url,github_user,token_cipher,updated_at)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET owner=excluded.owner,repo=excluded.repo,repository_url=excluded.repository_url,github_user=excluded.github_user,token_cipher=excluded.token_cipher,updated_at=excluded.updated_at`)
    .bind(userId, owner, repo, repository.html_url, identity?.login || "", await encryptSecret(token, env), Date.now()).run();
  return { connected: true, repository: owner + "/" + repo, repositoryUrl: repository.html_url, githubUser: identity?.login || "" };
}
async function githubGraphql(connection, query, variables) {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST", headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + connection.token, "X-GitHub-Api-Version": "2026-03-10", "User-Agent": "Automatizador-de-issues", "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.errors?.length) throw fail(data.errors?.map((item) => item.message).join("; ") || data.message || "GitHub não permitiu acessar os projetos.", response.status || 403);
  return data.data;
}
async function githubOptions(env, userId) {
  const connection = await githubConnection(env, userId);
  if (!connection) throw fail("Conecte um repositório GitHub primeiro.", 409);
  const labelsPromise = githubApi(`/repos/${encodeURIComponent(connection.owner)}/${encodeURIComponent(connection.repo)}/labels?per_page=100`, connection.token);
  const projectsPromise = githubGraphql(connection, PROJECT_QUERY, { owner: connection.owner, repo: connection.repo });
  const [labelsResult, projectsResult] = await Promise.allSettled([labelsPromise, projectsPromise]);
  if (labelsResult.status === "rejected") throw labelsResult.reason;
  if (!labelsResult.value.ok) throw fail(await githubError(labelsResult.value), labelsResult.value.status);
  const labels = await labelsResult.value.json();
  let projects = [], projectsError = "";
  if (projectsResult.status === "rejected") projectsError = projectsResult.reason.message || "Permissão Projects não concedida.";
  else {
    const repository = projectsResult.value?.repository;
    if (!repository) projectsError = "Não foi possível consultar projetos deste repositório.";
    else {
      const items = new Map();
      for (const project of repository.projectsV2?.nodes || []) items.set(project.id, project);
      for (const project of repository.owner?.projectsV2?.nodes || []) items.set(project.id, project);
      projects = Array.from(items.values()).map((project) => ({
        id: project.id, title: project.title, number: project.number,
        statusField: (project.fields.nodes || []).find((field) => field.__typename === "ProjectV2SingleSelectField" && field.name.toLowerCase() === "status") || null,
        singleSelectFields: (project.fields.nodes || []).filter((field) => field.__typename === "ProjectV2SingleSelectField").map((field) => ({ id: field.id, name: field.name, options: field.options }))
      }));
    }
  }
  return { labels: Array.isArray(labels) ? labels.map(({ name, description, color }) => ({ name, description, color })) : [], projects, projectsError };
}
async function createGithubIssue(env, body, userId) {
  const connection = await githubConnection(env, userId);
  if (!connection) throw fail("Conecte um repositório GitHub antes de criar a issue.", 409);
  const title = clean(body.title), description = typeof body.body === "string" ? body.body.trim() : "";
  const labels = Array.isArray(body.labels) ? Array.from(new Set(body.labels.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean))).slice(0, 100) : [];
  if (!title) throw fail("O título da issue é obrigatório.");
  if (!description) throw fail("O conteúdo da issue está vazio.");
  const user = await env.DB.prepare("SELECT username FROM users WHERE id=?").bind(userId).first();
  const text = description + "\n\n---\n**Aberta pela ferramenta por:** " + (user?.username || "Usuário autenticado") + (connection.githubUser ? " (GitHub: @" + connection.githubUser + ")" : "");
  const response = await githubApi(`/repos/${encodeURIComponent(connection.owner)}/${encodeURIComponent(connection.repo)}/issues`, connection.token, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, body: text, labels })
  });
  if (!response.ok) throw fail(await githubError(response), response.status === 401 || response.status === 403 || response.status === 404 ? response.status : 502);
  const issue = await response.json();
  const result = { number: issue.number, title: issue.title, url: issue.html_url, repository: connection.owner + "/" + connection.repo, labels: (issue.labels || []).map((label) => label.name) };
  const missing = labels.filter((label) => !result.labels.includes(label));
  if (missing.length) {
    const lr = await githubApi(`/repos/${encodeURIComponent(connection.owner)}/${encodeURIComponent(connection.repo)}/issues/${issue.number}/labels`, connection.token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ labels: missing }) });
    if (lr.ok) result.labels = (await lr.json()).map((label) => label.name);
    else result.labelsError = await githubError(lr);
  }
  if (body.projectId) {
    try {
      const metadata = await githubOptions(env, userId);
      const project = metadata.projects.find((item) => item.id === body.projectId);
      if (!project) throw new Error("O projeto selecionado não está disponível para este token.");
      const added = await githubGraphql(connection, `mutation($projectId:ID!,$contentId:ID!){addProjectV2ItemById(input:{projectId:$projectId,contentId:$contentId}){item{id}}}`, { projectId: project.id, contentId: issue.node_id });
      const itemId = added.addProjectV2ItemById.item.id;
      result.project = project.title;
      if (body.statusOptionId) {
        const field = project.singleSelectFields.find((item) => item.id === body.statusFieldId && item.name.toLowerCase() === "status");
        if (!field || !field.options.some((option) => option.id === body.statusOptionId)) throw new Error("A coluna selecionada não pertence ao campo Status deste projeto.");
        await githubGraphql(connection, `mutation($projectId:ID!,$itemId:ID!,$fieldId:ID!,$optionId:String!){updateProjectV2ItemFieldValue(input:{projectId:$projectId,itemId:$itemId,fieldId:$fieldId,value:{singleSelectOptionId:$optionId}}){projectV2Item{id}}}`, { projectId: project.id, itemId, fieldId: field.id, optionId: body.statusOptionId });
        result.status = field.options.find((option) => option.id === body.statusOptionId).name;
      }
    } catch (error) { result.projectError = error.message || "A issue foi criada, mas não foi possível adicioná-la ao projeto/status."; }
  }
  return result;
}
function guidance(preference) {
  if (preference === "bug") return "Modelo de bug: priorize comportamento observado e esperado, etapa em que ocorre, mensagem de erro e frequência quando esses dados estiverem no relato.";
  if (preference === "requisito") return "Modelo de melhoria: priorize fluxo atual, necessidade, comportamento desejado e resultado esperado; trate a solução como sugestão.";
  return "Modelo automático: classifique como bug se uma função existente falha; como requisito se for melhoria ou nova capacidade.";
}
async function generateDraft(env, body, userId) {
  const raw = clean(body.raw);
  if (raw.length < 10) throw fail("Descreva a solicitação com um pouco mais de detalhe.");
  if (raw.length > 20_000) throw fail("A descrição deve ter no máximo 20.000 caracteres.");
  const preference = ["bug", "requisito"].includes(body.classificationPreference) ? body.classificationPreference : "";
  const userData = {
    relato_livre: raw, respostas_as_perguntas_da_ia: body.answers && typeof body.answers === "object" ? body.answers : {},
    campos_ja_preenchidos: body.current && typeof body.current === "object" ? body.current : {},
    data_de_hoje: new Date().toISOString().slice(0, 10), tipo_solicitacao: preference || "automático",
    orientacao_do_modelo: guidance(preference), opcoes_motivacao: MOTIVATION, opcoes_urgencia: URGENCY
  };
  let memories=[];if(userId){const connection=await env.DB.prepare("SELECT owner,repo FROM github_connections WHERE user_id=?").bind(userId).first();const {results}=await env.DB.prepare("SELECT repository,number,title,content,created_at FROM account_memory WHERE user_id=? ORDER BY created_at DESC LIMIT 250").bind(userId).all();memories=selectAccountMemory(raw+" "+(body.current?.title||""),results,connection?connection.owner+"/"+connection.repo:"")};
  const systemPrompt = DRAFT_SYSTEM_PROMPT + fieldRefinementInstruction(body,SCHEMA.properties) + memoryInstruction(memories);
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: JSON.stringify(userData) }
  ];
  const model = env.CLOUDFLARE_AI_MODEL || MODEL_DEFAULT;
  let result;
  try { result = await env.AI.run(model, { messages, temperature: 0, max_tokens: 2600, response_format: { type: "json_schema", json_schema: SCHEMA } }); if(env.usage){const measured=measuredAiUsage(result,model);env.usage.aiCalls++;env.usage.neurons+=measured.neurons||0;env.usage.aiUnknown+=measured.aiUnknown||0} }
  catch (error) { const quota=dailyAiQuotaError(error);if(quota&&env.usage)env.usage.aiExhausted=1;else if(env.usage)env.usage.aiUnknown++;throw quota || fail(error.message || "Falha ao gerar o rascunho no Workers AI.", 502); }
  let draft = result?.response ?? result?.output_text;
  if (typeof draft === "string") {
    try { draft = JSON.parse(draft); }
    catch { const start = draft.indexOf("{"); const end = draft.lastIndexOf("}"); if (start < 0 || end <= start) throw fail("A resposta da IA não veio em formato estruturado. Tente novamente.", 502); try { draft = JSON.parse(draft.slice(start, end + 1)); } catch { throw fail("Não foi possível interpretar a resposta estruturada da IA.", 502); } }
  }
  if (!draft || typeof draft !== "object") throw fail("Workers AI não retornou um rascunho válido.", 502);
  const fields = ["title", "requester", "units", "frequency", "problem", "description", "impacts", "today", "nonimplementation", "otherMotivation"];
  const normalized = Object.fromEntries(fields.map((key) => [key, clean(draft[key])]));
  normalized.motivation = MOTIVATION.includes(draft.motivation) ? draft.motivation : "";
  normalized.urgency = URGENCY.includes(draft.urgency) ? draft.urgency : URGENCY[2];
  normalized.classification = preference || (draft.classification === "bug" ? "bug" : "requisito");
  normalized.questions = Array.isArray(draft.questions) ? draft.questions.slice(0, 1).map(clean).filter(Boolean) : [];
  const context = raw.replace(/\s+/g, " ").trim();
  for (const key of fields) {
    if (key === "otherMotivation") continue;
    if (!normalized[key]) normalized[key] = key === "title" ? context.slice(0, 90) : key === "today" ? "Análise de fluxo a validar: a rotina relacionada a “" + context.slice(0,420) + "” deve ser avaliada no ponto de uso da mudança, considerando a ação realizada pela equipe e o resultado esperado." : "Não informado no relato.";
  }
  if (normalized.motivation === MOTIVATION[5] && !normalized.otherMotivation) normalized.otherMotivation = "A motivação específica não foi detalhada no relato.";
  if (normalized.motivation !== MOTIVATION[5]) normalized.otherMotivation = "";
  for(const field of ["problem","description","impacts","today","nonimplementation","otherMotivation"])normalized[field]=formatDraftTopics(normalized[field]);
  normalized.title = formatIssueTitle(normalized.title, normalized.classification);
  return { draft: normalized, model, memoryUsed:memorySources(memories) };
}
async function oauthCallback(request, env, url) {
  const state = url.searchParams.get("state") || "";
  const stateHash = await digest(state);
  const pending = await env.DB.prepare("SELECT * FROM github_oauth_states WHERE state_hash=? AND expires_at>?").bind(stateHash, Date.now()).first();
  await env.DB.prepare("DELETE FROM github_oauth_states WHERE state_hash=?").bind(stateHash).run();
  if (!pending) return json({ error: "Autorização GitHub expirada ou inválida. Tente novamente." }, 400);
  const session = await env.DB.prepare("SELECT s.token_hash,s.expires_at,u.id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1").bind(pending.session_hash, Date.now()).first();
  if (!session) return json({ error: "Sua sessão expirou durante a autorização. Entre novamente." }, 401);
  if (url.searchParams.get("error")) return json({ error: "A autorização no GitHub foi cancelada ou negada." }, 400);
  const code = url.searchParams.get("code");
  if (!code) return json({ error: "O GitHub não retornou o código de autorização." }, 400);
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: env.GITHUB_APP_CLIENT_ID, client_secret: env.GITHUB_APP_CLIENT_SECRET, code, redirect_uri: env.GITHUB_APP_CALLBACK_URL })
  });
  const tokenData = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenData.access_token) return json({ error: "Não foi possível concluir a autorização do GitHub. Confira a configuração da GitHub App." }, 502);
  const profileResponse = await githubApi("/user", tokenData.access_token);
  const profile = await profileResponse.json().catch(() => ({}));
  if (!profileResponse.ok || !profile.login) return json({ error: "O GitHub autorizou a App, mas não foi possível identificar a conta." }, 502);
  const expiresAt = tokenData.expires_at ? Date.parse(tokenData.expires_at) : Date.now() + Number(tokenData.expires_in || 0) * 1000;
  await env.DB.prepare(`INSERT INTO github_identities(user_id,login,token_cipher,refresh_cipher,expires_at) VALUES(?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET login=excluded.login,token_cipher=excluded.token_cipher,refresh_cipher=excluded.refresh_cipher,expires_at=excluded.expires_at`)
    .bind(session.id, profile.login, await encryptSecret(tokenData.access_token, env), tokenData.refresh_token ? await encryptSecret(tokenData.refresh_token, env) : null, expiresAt).run();
  await env.DB.prepare("DELETE FROM github_connections WHERE user_id=?").bind(session.id).run();
  return Response.redirect(new URL("/?github=connected", env.APP_BASE_URL || url.origin).toString(), 302);
}
async function route(request, env) {
  const url = new URL(request.url), path = url.pathname, method = request.method;
  if (path.startsWith("/api/") && !["GET", "HEAD"].includes(method) && !(await sameOrigin(request))) return json({ error: "Origem da solicitação não permitida." }, 403);
  if (path === "/api/auth/setup-status" && method === "GET") {
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM users").first();
    return json({ setupRequired: count.count === 0, setupEnabled: !!env.ADMIN_SETUP_KEY });
  }
  if (path === "/api/auth/setup" && method === "POST") {
    const body = await readBody(request), count = await env.DB.prepare("SELECT COUNT(*) AS count FROM users").first();
    if (count.count) throw fail("A configuração inicial já foi concluída.", 409);
    if (!env.ADMIN_SETUP_KEY) throw fail("Configure ADMIN_SETUP_KEY nos segredos do Worker para iniciar a conta administradora.", 503);
    if (!constantTimeTextEqual(clean(body.setupKey), env.ADMIN_SETUP_KEY)) throw fail("Chave inicial incorreta.", 403);
    if (!validUsername(body.username) || !validPassword(body.password)) throw fail("Use um usuário de 3 a 32 caracteres e uma senha de até 128 caracteres.");
    const credentials = await passwordHash(body.password), id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO users(id,username,username_norm,role,active,created_at,password_salt,password_hash) VALUES(?,?,?,'admin',1,?,?,?)")
      .bind(id, body.username, body.username.toLowerCase(), Date.now(), credentials.salt, credentials.hash).run();
    return withCookie(json({ user: safeUser({ id, username: body.username, role: "admin", active: 1, created_at: Date.now() }) }, 201), await createSession(env, id), SESSION_TTL);
  }
  if (path === "/api/auth/login" && method === "POST") {
    const body = await readBody(request);
    const user = await env.DB.prepare("SELECT * FROM users WHERE username_norm=? AND active=1").bind(clean(body.username).toLowerCase()).first();
    if (!user || !await verifyPassword(typeof body.password === "string" ? body.password : "", user)) throw fail("Usuário ou senha incorretos.", 401);
    return withCookie(json({ user: safeUser(user) }), await createSession(env, user.id), SESSION_TTL);
  }
  const session = await sessionFor(request, env);
  if (path === "/api/auth/me" && method === "GET") return json({ user: session ? safeUser(session.user) : null });
  if (path === "/api/auth/logout" && method === "POST") {
    if (session) await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(session.tokenHash).run();
    return withCookie(json({ ok: true }), "", 0);
  }
  if (path === "/api/github/oauth/callback" && method === "GET") {
    if (!githubOAuthConfigured(env)) throw fail("Configure a GitHub App antes de autorizar contas.", 503);
    return oauthCallback(request, env, url);
  }
  if (path.startsWith("/api/") && !session) throw fail("Faça login para continuar.", 401);
  const userId = session?.user.id;
  if(path==='/api/admin/quotas'&&method==='GET'){
    if(session.user.role!=='admin')throw fail('Somente administradores podem consultar as cotas.',403);
    const row=await env.DB.prepare('SELECT * FROM daily_usage WHERE day=?').bind(new Date().toISOString().slice(0,10)).first();
    return json(quotaSummary(row));
  }
  if(path==="/api/memory"&&method==="GET"){const row=await env.DB.prepare("SELECT COUNT(*) AS count FROM account_memory WHERE user_id=?").bind(userId).first();return json({count:row.count})}
  if(path==="/api/memory"&&method==="DELETE"){await env.DB.prepare("DELETE FROM account_memory WHERE user_id=?").bind(userId).run();return json({ok:true})}
  if(path==='/api/history'&&method==='GET'){const {results}=await env.DB.prepare('SELECT entry FROM issue_history WHERE user_id=? ORDER BY created_at DESC LIMIT 500').bind(userId).all();return json({issues:results.map(row=>JSON.parse(row.entry))})}
  if(path==='/api/history'&&method==='POST'){
    const body=await readBody(request,110000);if(!Array.isArray(body.issues)||body.issues.length>200)throw fail('Envie até 200 registros.');
    const entries=body.issues.map(validateHistoryEntry);if(entries.length)await env.DB.batch(entries.map(entry=>env.DB.prepare('INSERT OR IGNORE INTO issue_history(user_id,repository,number,entry,created_at) VALUES(?,?,?,?,?)').bind(userId,entry.repository,entry.number,JSON.stringify(entry),entry.createdAt)));return json({ok:true});
  }
  if(path==='/api/history'&&method==='DELETE'){await env.DB.prepare('DELETE FROM issue_history WHERE user_id=?').bind(userId).run();return json({ok:true})}
  if(path==='/api/drafts'&&method==='GET'){
    const {results}=await env.DB.prepare('SELECT id,name,revision,updated_at FROM saved_drafts WHERE user_id=? ORDER BY updated_at DESC').bind(userId).all();return json({drafts:results});
  }
  if(path==='/api/drafts'&&method==='POST'){
    const body=await readBody(request,110000),draft=validateSavedDraft(body),id=body.id||crypto.randomUUID();
    if(body.id){
      const result=await env.DB.prepare('UPDATE saved_drafts SET name=?,snapshot=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=?').bind(draft.name,JSON.stringify(draft.snapshot),Date.now(),id,userId,body.revision).run();
      if(!result.meta.changes)throw fail('O rascunho foi alterado em outro dispositivo ou removido. Recarregue antes de salvar.',409);
    }else await env.DB.prepare('INSERT INTO saved_drafts(id,user_id,name,snapshot,updated_at) VALUES(?,?,?,?,?)').bind(id,userId,draft.name,JSON.stringify(draft.snapshot),Date.now()).run();
    const row=await env.DB.prepare('SELECT id,name,revision,updated_at FROM saved_drafts WHERE id=? AND user_id=?').bind(id,userId).first();return json({draft:row});
  }
  const draftMatch=path.match(/^\/api\/drafts\/([a-zA-Z0-9-]+)$/);
  if(draftMatch&&method==='GET'){
    const row=await env.DB.prepare('SELECT * FROM saved_drafts WHERE id=? AND user_id=?').bind(draftMatch[1],userId).first();if(!row)throw fail('Rascunho não encontrado.',404);return json({draft:{id:row.id,name:row.name,revision:row.revision,snapshot:JSON.parse(row.snapshot)}});
  }
  if(draftMatch&&method==='DELETE'){
    const body=await readBody(request);const result=await env.DB.prepare('DELETE FROM saved_drafts WHERE id=? AND user_id=? AND revision=?').bind(draftMatch[1],userId,body.revision).run();if(!result.meta.changes)throw fail('O rascunho mudou. Recarregue antes de excluir.',409);return json({ok:true});
  }
  if(path==='/api/github/similar'&&method==='GET')return json(await findSimilarIssues(await githubConnection(env,userId),url.searchParams.get('title'),githubApi));
  if(path === "/api/github/attachments" && method === "POST") {
    const connection=await githubConnection(env,userId);if(!connection)throw fail("Conecte um repositório GitHub primeiro.",409);
    return json(await uploadGithubAttachment(connection,url.searchParams.get("name"),await readAttachment(request.body)),201);
  }
  if (path === "/api/github/oauth/status" && method === "GET") {
    const identity = await env.DB.prepare("SELECT login FROM github_identities WHERE user_id=?").bind(userId).first();
    return json({ available: githubOAuthConfigured(env), connected: !!identity, githubUser: identity?.login || "" });
  }
  if (path === "/api/github/oauth/start" && method === "GET") {
    if (!githubOAuthConfigured(env)) throw fail("Configure GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET e GITHUB_APP_CALLBACK_URL nos segredos do Worker.", 503);
    const token = session.token, state = randomToken();
    await env.DB.prepare("INSERT INTO github_oauth_states(state_hash,user_id,session_hash,expires_at) VALUES(?,?,?,?)").bind(await digest(state), userId, await digest(token), Date.now() + 10 * 60 * 1000).run();
    const authorize = new URL("https://github.com/login/oauth/authorize");
    authorize.searchParams.set("client_id", env.GITHUB_APP_CLIENT_ID); authorize.searchParams.set("redirect_uri", env.GITHUB_APP_CALLBACK_URL); authorize.searchParams.set("state", state);
    return Response.redirect(authorize.toString(), 302);
  }
  if (path === "/api/admin/users" && method === "GET") {
    if (session.user.role !== "admin") throw fail("Somente administradores podem gerenciar contas.", 403);
    const { results } = await env.DB.prepare("SELECT id,username,role,active,created_at FROM users ORDER BY created_at").all();
    return json({ users: results.map(safeUser) });
  }
  if (path === "/api/admin/users" && method === "POST") {
    if (session.user.role !== "admin") throw fail("Somente administradores podem gerenciar contas.", 403);
    const body = await readBody(request);
    if (!validUsername(body.username) || !validPassword(body.password)) throw fail("Use um usuário de 3 a 32 caracteres e uma senha de até 128 caracteres.");
    const exists = await env.DB.prepare("SELECT id FROM users WHERE username_norm=?").bind(body.username.toLowerCase()).first();
    if (exists) throw fail("Esse usuário já existe.", 409);
    const credentials = await passwordHash(body.password), id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO users(id,username,username_norm,role,active,created_at,password_salt,password_hash) VALUES(?,?,?,?,1,?,?,?)")
      .bind(id, body.username, body.username.toLowerCase(), body.role === "admin" ? "admin" : "user", Date.now(), credentials.salt, credentials.hash).run();
    return json({ user: safeUser({ id, username: body.username, role: body.role === "admin" ? "admin" : "user", active: 1, created_at: Date.now() }) }, 201);
  }
  const userMatch = path.match(/^\/api\/admin\/users\/([0-9a-f-]+)$/i);
  if (userMatch && method === "PATCH") {
    if (session.user.role !== "admin") throw fail("Somente administradores podem gerenciar contas.", 403);
    const target = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(userMatch[1]).first();
    if (!target) throw fail("Usuário não encontrado.", 404);
    const body = await readBody(request);
    const updates = [];
    if (typeof body.active === "boolean") {
      if (!body.active && target.role === "admin") {
        const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE role='admin' AND active=1").first();
        if (count.count < 2) throw fail("Mantenha pelo menos um administrador ativo.", 409);
      }
      updates.push(env.DB.prepare("UPDATE users SET active=? WHERE id=?").bind(body.active ? 1 : 0, target.id));
      if (!body.active) updates.push(env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(target.id), env.DB.prepare("DELETE FROM github_connections WHERE user_id=?").bind(target.id), env.DB.prepare("DELETE FROM github_identities WHERE user_id=?").bind(target.id));
    }
    if (body.password !== undefined) {
      if (!validPassword(body.password)) throw fail("A senha não pode ficar vazia e deve ter até 128 caracteres.");
      const credentials = await passwordHash(body.password);
      updates.push(env.DB.prepare("UPDATE users SET password_salt=?,password_hash=? WHERE id=?").bind(credentials.salt, credentials.hash, target.id));
      updates.push(env.DB.prepare("DELETE FROM sessions WHERE user_id=? AND token_hash<>?").bind(target.id, session.tokenHash));
    }
    if (body.role === "admin" || body.role === "user") {
      if (target.role === "admin" && body.role !== "admin") {
        const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE role='admin' AND active=1").first();
        if (count.count < 2) throw fail("Mantenha pelo menos um administrador ativo.", 409);
      }
      updates.push(env.DB.prepare("UPDATE users SET role=? WHERE id=?").bind(body.role, target.id));
    }
    if (updates.length) await env.DB.batch(updates);
    const updated = await env.DB.prepare("SELECT id,username,role,active,created_at FROM users WHERE id=?").bind(target.id).first();
    return json({ user: safeUser(updated) });
  }
  if (path === "/api/github/status" && method === "GET") {
    const connection = await env.DB.prepare("SELECT owner,repo,repository_url,github_user FROM github_connections WHERE user_id=?").bind(userId).first();
    return json(connection ? { connected: true, repository: connection.owner + "/" + connection.repo, repositoryUrl: connection.repository_url, githubUser: connection.github_user || "" } : { connected: false });
  }
  if (path === "/api/github/connect" && method === "POST") return json(await connectGithub(env, await readBody(request), userId));
  if (path === "/api/github/options" && method === "GET") return json(await githubOptions(env, userId));
  if (path === "/api/github/disconnect" && method === "POST") {
    await env.DB.batch([env.DB.prepare("DELETE FROM github_connections WHERE user_id=?").bind(userId), env.DB.prepare("DELETE FROM github_identities WHERE user_id=?").bind(userId)]);
    return json({ connected: false });
  }
  if (path === "/api/github/issues" && method === "POST") {
    const body=await readBody(request),result=await createGithubIssue(env,body,userId);try{await env.DB.prepare("INSERT OR REPLACE INTO account_memory(user_id,repository,number,title,content,created_at) VALUES(?,?,?,?,?,?)").bind(userId,result.repository.toLowerCase(),result.number,result.title,memoryContent(body),Date.now()).run()}catch(error){result.memoryError="A issue foi criada, mas não foi possível guardar a memória da conta."}try{const entry=validateHistoryEntry({...result,createdAt:Date.now()});await env.DB.prepare("INSERT OR REPLACE INTO issue_history(user_id,repository,number,entry,created_at) VALUES(?,?,?,?,?)").bind(userId,entry.repository,entry.number,JSON.stringify(entry),entry.createdAt).run();result.createdAt=entry.createdAt}catch(error){result.historyError="A issue foi criada, mas o histórico da conta não pôde ser salvo."}return json(result,201);
  }
  if (path === "/api/status" && method === "GET") return json({ provider: "cloudflare", available: true, model: env.CLOUDFLARE_AI_MODEL || MODEL_DEFAULT, modelInstalled: true });
  if (path === "/api/draft" && method === "POST") return json(await generateDraft(env, await readBody(request),userId));
  if (path.startsWith("/api/")) throw fail("Rota não encontrada.", 404);
  if(path==="/public/workflow-ui.js" && ["GET","HEAD"].includes(method))return env.ASSETS.fetch(new Request(new URL("/workflow-ui.js",request.url),{method,headers:request.headers}));
  if(path==='/public/quota-ui.js'&&['GET','HEAD'].includes(method))return env.ASSETS.fetch(new Request(new URL('/quota-ui.js',request.url),{method,headers:request.headers}));
  if ((path === "/" || path === "/index.html") && ["GET", "HEAD"].includes(method)) {
    const assetUrl = new URL("/index.html", request.url);
    assetUrl.search = url.search;
    const assetRequest = new Request(assetUrl, { method, headers: request.headers });
    return env.ASSETS.fetch(assetRequest);
  }
  return new Response("Não encontrado.", { status: 404 });
}
function constantTimeTextEqual(left, right) {
  const a = new TextEncoder().encode(String(left)), b = new TextEncoder().encode(String(right));
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) difference |= (a[i] || 0) ^ (b[i] || 0);
  return difference === 0;
}

export default {
  async fetch(request, env, context) {
    const tracker=trackDailyUsage(env);env=tracker.env;
    try { return await route(request, env); }
    catch (error) { return json({ error: error.message || "Erro interno do servidor.", ...(error.code === 'AI_DAILY_QUOTA_EXCEEDED' ? { code: error.code, resetAt: error.resetAt, retryAfter: error.retryAfter } : {}) }, error.status || 500); }
    finally { const saving=tracker.flush().catch(()=>{});if(context?.waitUntil)context.waitUntil(saving);else await saving; }
  }
};
