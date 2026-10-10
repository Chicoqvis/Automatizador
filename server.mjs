import { DRAFT_SYSTEM_PROMPT, formatIssueTitle } from "./draft-prompt.mjs";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const AI_PROVIDER = (process.env.AI_PROVIDER || "ollama").trim().toLowerCase();
const OLLAMA_BASE = (process.env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/+$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:1.7b";
const CLOUDFLARE_AI_URL = (process.env.CLOUDFLARE_AI_URL || "").replace(/\/+$/, "");
const CLOUDFLARE_AI_TOKEN = process.env.CLOUDFLARE_AI_TOKEN || "";
const DATA_DIR = path.join(ROOT, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const scrypt = promisify(scryptCallback);
const sessions = new Map();
const githubConnections = new Map();
const githubOAuthIdentities = new Map();
const githubOAuthStates = new Map();
let users = [];
const URGENCY = [
  "Crítico (Impacto severo no funcionamento do hospital (paralisação, erro grave))",
  "Alto (Impacto grande, mas não impede totalmente as operações)",
  "Médio (Melhoria importante, mas não urgente)",
  "Baixo (Melhoria pequena ou ajuste estético)"
];
const MOTIVATION = [
  "Redução de custo",
  "Aumento de receita",
  "Redução de erros operacionais",
  "Melhoria na experiência do usuário",
  "Atendimento a exigências regulatórias",
  "Outras [Descreva abaixo]"
];
const schema = {
  type: "object",
  properties: {
    title: { type: "string" },
    requester: { type: "string" },
    units: { type: "string" },
    frequency: { type: "string" },
    problem: { type: "string" },
    description: { type: "string" },
    impacts: { type: "string" },
    today: { type: "string" },
    nonimplementation: { type: "string" },
    motivation: { type: "string", enum: ["", ...MOTIVATION] },
    otherMotivation: { type: "string" },
    urgency: { type: "string", enum: ["", ...URGENCY] },
    classification: { type: "string", enum: ["bug", "requisito"] },
    questions: { type: "array", items: { type: "string" }, maxItems: 1 }
  },
  required: ["title", "requester", "units", "frequency", "problem", "description", "impacts", "today", "nonimplementation", "motivation", "otherMotivation", "urgency", "classification", "questions"],
  additionalProperties: false
};

async function getModels() {
  const response = await fetch(OLLAMA_BASE + "/api/tags", { signal: AbortSignal.timeout(2500) });
  if (!response.ok) throw new Error("Ollama respondeu com HTTP " + response.status);
  const data = await response.json();
  return Array.isArray(data.models) ? data.models.map((item) => item.name) : [];
}

function aiModel() {
  return AI_PROVIDER === "cloudflare" ? (process.env.CLOUDFLARE_AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast") : OLLAMA_MODEL;
}

async function aiStatus() {
  if (AI_PROVIDER === "cloudflare") {
    const configured = !!(CLOUDFLARE_AI_URL && CLOUDFLARE_AI_TOKEN);
    if (!configured) return { provider: "cloudflare", available: false, model: aiModel(), modelInstalled: false };
    try {
      const response = await fetch(CLOUDFLARE_AI_URL + "/health", { headers: { Authorization: "Bearer " + CLOUDFLARE_AI_TOKEN }, signal: AbortSignal.timeout(2500) });
      if (!response.ok) throw new Error("Worker indisponível");
      const state = await response.json();
      return { provider: "cloudflare", available: !!state.available, model: state.model || aiModel(), modelInstalled: !!state.available };
    } catch {
      return { provider: "cloudflare", available: false, model: aiModel(), modelInstalled: false };
    }
  }
  try {
    const models = await getModels();
    return { provider: "ollama", available: true, model: OLLAMA_MODEL, modelInstalled: models.some((name) => name === OLLAMA_MODEL || name.startsWith(OLLAMA_MODEL + ":")) };
  } catch {
    return { provider: "ollama", available: false, model: OLLAMA_MODEL, modelInstalled: false };
  }
}

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

function readBody(req, maxBytes = 30000) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > maxBytes) {
        reject(new Error("A descrição ultrapassa o limite de 30 KB."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); }
      catch { reject(new Error("O conteúdo enviado não é um JSON válido.")); }
    });
    req.on("error", reject);
  });
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function generate(body) {
  const raw = clean(body.raw);
  if (raw.length < 10) throw Object.assign(new Error("Descreva a solicitação com um pouco mais de detalhe."), { status: 400 });
  if (raw.length > 20000) throw Object.assign(new Error("A descrição deve ter no máximo 20.000 caracteres."), { status: 400 });

  if (AI_PROVIDER !== "ollama" && AI_PROVIDER !== "cloudflare") {
    throw Object.assign(new Error("AI_PROVIDER deve ser 'ollama' ou 'cloudflare'."), { status: 500 });
  }
  if (AI_PROVIDER === "ollama") {
    const models = await getModels();
    if (!models.some((name) => name === OLLAMA_MODEL || name.startsWith(OLLAMA_MODEL + ":"))) {
      throw Object.assign(new Error("O modelo " + OLLAMA_MODEL + " não foi encontrado no Ollama. Baixe-o com: ollama pull " + OLLAMA_MODEL), { status: 409 });
    }
  } else if (!CLOUDFLARE_AI_URL || !CLOUDFLARE_AI_TOKEN) {
    throw Object.assign(new Error("Configure CLOUDFLARE_AI_URL e CLOUDFLARE_AI_TOKEN para usar Workers AI."), { status: 503 });
  }

  const current = body.current && typeof body.current === "object" ? body.current : {};
  const classificationPreference = ["bug", "requisito"].includes(body.classificationPreference) ? body.classificationPreference : "";
  const templateGuidance = classificationPreference === "bug"
    ? "Modelo de bug: priorize comportamento observado e esperado, etapa em que ocorre, mensagem de erro e frequência quando esses dados estiverem no relato."
    : classificationPreference === "requisito"
      ? "Modelo de melhoria: priorize fluxo atual, necessidade, comportamento desejado e resultado esperado; trate a solução como sugestão."
      : "Modelo automático: classifique como bug se uma função existente falha; como requisito se for melhoria ou nova capacidade.";
  const userData = {
    relato_livre: raw,
    respostas_as_perguntas_da_ia: body.answers && typeof body.answers === "object" ? body.answers : {},
    campos_ja_preenchidos: current,
    data_de_hoje: new Date().toISOString().slice(0, 10),
    tipo_solicitacao: classificationPreference || "automático",
    orientacao_do_modelo: templateGuidance,
    opcoes_motivacao: MOTIVATION,
    opcoes_urgencia: URGENCY
  };
  const systemPrompt = DRAFT_SYSTEM_PROMPT;
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: JSON.stringify(userData) }
  ];
  const cloudflare = AI_PROVIDER === "cloudflare";
  const response = await fetch(cloudflare ? CLOUDFLARE_AI_URL + "/v1/draft" : OLLAMA_BASE + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cloudflare ? { Authorization: "Bearer " + CLOUDFLARE_AI_TOKEN } : {}) },
    signal: AbortSignal.timeout(180000),
    body: JSON.stringify(cloudflare
      ? { model: aiModel(), messages, schema }
      : { model: OLLAMA_MODEL, stream: false, think: false, format: schema, keep_alive: "15m", options: { temperature: 0, num_predict: 2400, num_ctx: Math.max(4096, Math.ceil((JSON.stringify(userData).length + 4000) / 2)) }, messages })
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw Object.assign(new Error("Falha ao gerar rascunho em " + (cloudflare ? "Cloudflare Workers AI" : "Ollama") + " (HTTP " + response.status + "). " + detail.slice(0, 300)), { status: 502 });
  }
  const result = await response.json();
  const content = cloudflare ? result.response : result && result.message && result.message.content;
  if (typeof content !== "string") throw Object.assign(new Error("O modelo de IA não retornou conteúdo."), { status: 502 });
  let draft;
  try { draft = JSON.parse(content); }
  catch {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start < 0 || end <= start) throw Object.assign(new Error("A resposta do modelo não veio em formato estruturado. Tente novamente."), { status: 502 });
    try { draft = JSON.parse(content.slice(start, end + 1)); }
    catch { throw Object.assign(new Error("Não foi possível interpretar a resposta estruturada do modelo."), { status: 502 }); }
  }

  const resultFields = ["title", "requester", "units", "frequency", "problem", "description", "impacts", "today", "nonimplementation", "otherMotivation"];
  const normalized = {};
  for (const key of resultFields) normalized[key] = clean(draft[key]);
  normalized.motivation = MOTIVATION.includes(draft.motivation) ? draft.motivation : "";
  normalized.urgency = URGENCY.includes(draft.urgency) ? draft.urgency : "";
  normalized.classification = classificationPreference || (draft.classification === "bug" ? "bug" : "requisito");
  const fullContext = raw.replace(/\s+/g, " ").trim();
  const context = fullContext.length > 420 ? fullContext.slice(0, 417).replace(/\s+\S*$/, "") + "…" : fullContext;
  const fallbackText = {
    title: context.slice(0, 90).replace(/\s+\S*$/, ""),
    requester: "Solicitante não identificado no relato.",
    units: "Unidades não identificadas no relato.",
    frequency: "Frequência não especificada no relato.",
    problem: "O relato não trouxe detalhes suficientes para descrever o comportamento observado e a dificuldade.",
    description: "O relato não trouxe detalhes suficientes para definir a mudança solicitada e o resultado esperado.",
    impacts: "Impactos em outros módulos ou relatórios não foram informados no relato.",
    today: "O fluxo atual e eventuais medidas de contorno não foram informados no relato.",
    nonimplementation: "Não há informações suficientes no relato para estimar a consequência da não implementação.",
    otherMotivation: "A motivação específica não foi detalhada no relato."
  };
  const genericOnly = /^(?:teste|test|a confirmar(?: pelo solicitante| se geral ou pontual| com equipes relacionadas)?|não informado(?: no relato)?(?: — confirmar)?|impacto a confirmar)[.! ]*$/i;
  for (const key of resultFields) {
    if (key === "otherMotivation") continue;
    if (!normalized[key] || genericOnly.test(normalized[key])) normalized[key] = fallbackText[key] || context;
  }
  if (!normalized.motivation) normalized.motivation = /erro|falha|retrabalho|inconsist/i.test(raw) ? "Redução de erros operacionais" : /regulat|lei|norma/i.test(raw) ? "Atendimento a exigências regulatórias" : /receita|venda|fatur/i.test(raw) ? "Aumento de receita" : /custo|despesa/i.test(raw) ? "Redução de custo" : "";
  if (!normalized.urgency) normalized.urgency = URGENCY[2];
  if (normalized.motivation === MOTIVATION[5]) {
    if (!normalized.otherMotivation || genericOnly.test(normalized.otherMotivation)) normalized.otherMotivation = fallbackText.otherMotivation;
  } else normalized.otherMotivation = "";
  normalized.questions = Array.isArray(draft.questions) ? draft.questions.slice(0, 1).map(clean).filter(Boolean) : [];
  normalized.title = formatIssueTitle(normalized.title, normalized.classification);
  return { draft: normalized, model: aiModel() };
}

const draftJobs = new Map();

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((part) => part.trim().split(/=(.*)/s).slice(0, 2)).filter(([key, value]) => key && value !== undefined).map(([key, value]) => [key, decodeURIComponent(value)]));
}

function sessionFor(req) {
  const session = sessions.get(parseCookies(req.headers.cookie).automacao_session);
  if (!session || session.expiresAt < Date.now()) return null;
  const user = users.find((item) => item.id === session.userId && item.active);
  return user ? { ...session, user } : null;
}

function sessionCookie(req, value, maxAge) {
  const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  return `automacao_session=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    return parsed.host === host;
  } catch { return false; }
}

async function saveUsers() {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  await fs.promises.writeFile(USERS_FILE, JSON.stringify(users, null, 2), { mode: 0o600 });
}

async function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = await scrypt(password, salt, 64);
  return { salt, hash: Buffer.from(hash).toString("hex") };
}

async function verifyPassword(password, user) {
  if (!user || typeof user.salt !== "string") return false;
  const storedHash = typeof user.hash === "string" ? user.hash : user.passwordHash;
  if (typeof storedHash !== "string" || !/^[a-f0-9]{128}$/i.test(storedHash)) return false;
  const candidate = await hashPassword(password, user.salt);
  const candidateBuffer = Buffer.from(candidate.hash, "hex");
  const storedBuffer = Buffer.from(storedHash, "hex");
  return candidateBuffer.length === storedBuffer.length && timingSafeEqual(candidateBuffer, storedBuffer);
}

function safeUser(user) {
  return { id: user.id, username: user.username, role: user.role, active: user.active, createdAt: user.createdAt };
}

async function initializeUsers() {
  try {
    const loaded = JSON.parse(await fs.promises.readFile(USERS_FILE, "utf8"));
    if (Array.isArray(loaded)) users = loaded;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function validUsername(value) { return typeof value === "string" && /^[a-zA-Z0-9._-]{3,32}$/.test(value); }
function validPassword(value) { return typeof value === "string" && value.length > 0 && value.length <= 128; }
function constantTimeTextEqual(left, right) {
  const a = Buffer.from(String(left)); const b = Buffer.from(String(right));
  if (a.length !== b.length) { timingSafeEqual(a, a); return false; }
  return timingSafeEqual(a, b);
}

async function githubApi(pathname, token, init) {
  return fetch("https://api.github.com" + pathname, {
    ...init,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": "Bearer " + token,
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "Clareia-Local-Issue-Assistant",
      ...(init && init.headers ? init.headers : {})
    },
    signal: AbortSignal.timeout(20000)
  });
}

async function githubError(response) {
  let message = "GitHub respondeu com HTTP " + response.status + ".";
  try {
    const data = await response.json();
    if (data.message) message = data.message;
  } catch {}
  return message;
}

async function connectGithub(body, userId) {
  const target = clean(body.repository);
  const suppliedToken = clean(body.token);
  const identity = suppliedToken ? githubOAuthIdentities.get(userId) : await ensureGithubOAuthIdentity(userId);
  const token = suppliedToken || (identity && identity.token) || "";
  const match = target.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match) throw Object.assign(new Error("Informe o repositório no formato organização/repositório."), { status: 400 });
  if (!token) throw Object.assign(new Error("Informe um token de acesso do GitHub."), { status: 400 });
  const owner = match[1];
  const repo = match[2];
  const response = await githubApi("/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo), token);
  if (!response.ok) {
    const githubMessage = await githubError(response);
    if (response.status === 404) {
      throw Object.assign(new Error("GitHub respondeu Not Found. Confira organização/repositório e se esse repositório foi selecionado no token. Em repositórios privados, o GitHub também retorna 404 quando o token não tem acesso."), { status: 404 });
    }
    if (response.status === 401) {
      throw Object.assign(new Error("Token inválido ou expirado. Gere outro token e tente novamente."), { status: 401 });
    }
    if (response.status === 403) {
      throw Object.assign(new Error("Acesso negado. Confira Issues: Read and write e se a organização exige aprovação do token. Detalhe do GitHub: " + githubMessage), { status: 403 });
    }
    throw Object.assign(new Error("Não foi possível validar o repositório. Detalhe do GitHub: " + githubMessage), { status: 502 });
  }
  const repository = await response.json();
  const githubUser = suppliedToken ? "" : identity && identity.login || "";
  githubConnections.set(userId, { owner: owner, repo: repo, token: token, repositoryUrl: repository.html_url, githubUser });
  return { connected: true, repository: owner + "/" + repo, repositoryUrl: repository.html_url, githubUser };
}

function githubOAuthIsConfigured() {
  return !!(process.env.GITHUB_APP_CLIENT_ID && process.env.GITHUB_APP_CLIENT_SECRET && process.env.GITHUB_APP_CALLBACK_URL);
}
function githubTokenExpiry(data) {
  if (data.expires_at) return Date.parse(data.expires_at);
  return Number(data.expires_in) > 0 ? Date.now() + Number(data.expires_in) * 1000 : 0;
}

async function githubOAuthCallback(req, res, url) {
  const state = url.searchParams.get("state") || "";
  const pending = githubOAuthStates.get(state);
  githubOAuthStates.delete(state);
  if (!pending || pending.expiresAt < Date.now()) return send(res, 400, { error: "Autorização GitHub expirada ou inválida. Tente novamente." });
  const session = sessions.get(pending.sessionToken);
  const user = session && users.find((item) => item.id === session.userId && item.active);
  if (!session || session.expiresAt < Date.now() || !user) return send(res, 401, { error: "Sua sessão expirou durante a autorização. Entre novamente." });
  if (url.searchParams.get("error")) return send(res, 400, { error: "A autorização no GitHub foi cancelada ou negada." });
  const code = url.searchParams.get("code");
  if (!code) return send(res, 400, { error: "O GitHub não retornou o código de autorização." });
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST", headers: { "Accept": "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: process.env.GITHUB_APP_CLIENT_ID, client_secret: process.env.GITHUB_APP_CLIENT_SECRET, code, redirect_uri: process.env.GITHUB_APP_CALLBACK_URL }),
    signal: AbortSignal.timeout(15000)
  });
  const tokenData = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenData.access_token) return send(res, 502, { error: "Não foi possível concluir a autorização do GitHub. Confira a configuração da GitHub App." });
  const profileResponse = await fetch("https://api.github.com/user", { headers: { "Accept": "application/vnd.github+json", "Authorization": "Bearer " + tokenData.access_token, "X-GitHub-Api-Version": "2026-03-10", "User-Agent": "Automacao-de-issues" }, signal: AbortSignal.timeout(15000) });
  const profile = await profileResponse.json().catch(() => ({}));
  if (!profileResponse.ok || !profile.login) return send(res, 502, { error: "O GitHub autorizou a App, mas não foi possível identificar a conta." });
  githubOAuthIdentities.set(user.id, { token: tokenData.access_token, login: profile.login, refreshToken: tokenData.refresh_token || "", expiresAt: githubTokenExpiry(tokenData) });
  githubConnections.delete(user.id);
  const base = process.env.APP_BASE_URL || new URL(process.env.GITHUB_APP_CALLBACK_URL).origin;
  res.writeHead(302, { "Location": new URL("/?github=connected", base).toString(), "Cache-Control": "no-store" });
  res.end();
}

async function ensureGithubOAuthIdentity(userId) {
  const identity = githubOAuthIdentities.get(userId);
  if (!identity || !identity.expiresAt || identity.expiresAt > Date.now() + 5 * 60 * 1000) return identity;
  if (!identity.refreshToken) {
    githubOAuthIdentities.delete(userId); githubConnections.delete(userId);
    throw Object.assign(new Error("A autorização do GitHub expirou. Conecte sua conta novamente."), { status: 401 });
  }
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST", headers: { "Accept": "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: process.env.GITHUB_APP_CLIENT_ID, client_secret: process.env.GITHUB_APP_CLIENT_SECRET, grant_type: "refresh_token", refresh_token: identity.refreshToken }),
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    githubOAuthIdentities.delete(userId); githubConnections.delete(userId);
    throw Object.assign(new Error("Não foi possível renovar a autorização GitHub. Conecte sua conta novamente."), { status: 401 });
  }
  Object.assign(identity, { token: data.access_token, refreshToken: data.refresh_token || "", expiresAt: githubTokenExpiry(data) });
  const connection = githubConnections.get(userId); if (connection && connection.githubUser === identity.login) connection.token = identity.token;
  return identity;
}

async function githubGraphql(connection, query, variables) {
  if (!connection) throw Object.assign(new Error("Conecte o GitHub primeiro."), { status: 409 });
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { "Accept": "application/vnd.github+json", "Authorization": "Bearer " + connection.token, "X-GitHub-Api-Version": "2026-03-10", "User-Agent": "Clareia-Local-Issue-Assistant", "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || (data.errors && data.errors.length)) {
    const detail = data.errors && data.errors.map((item) => item.message).join("; ");
    throw Object.assign(new Error(detail || data.message || "GitHub não permitiu acessar os projetos. Verifique a permissão Projects do token."), { status: response.status || 403 });
  }
  return data.data;
}

const projectFieldsQuery = `query($owner:String!, $repo:String!) {
  repository(owner:$owner, name:$repo) {
    projectsV2(first:100) { nodes { ...ProjectInfo } }
    owner {
      __typename
      ... on Organization { projectsV2(first:100) { nodes { ...ProjectInfo } } }
      ... on User { projectsV2(first:100) { nodes { ...ProjectInfo } } }
    }
  }
}
fragment ProjectInfo on ProjectV2 {
  id
  title
  number
  fields(first:50) {
    nodes {
      __typename
      ... on ProjectV2SingleSelectField { id name options { id name } }
    }
  }
}`

async function githubOptions(userId) {
  let connection = githubConnections.get(userId);
  if (!connection) throw Object.assign(new Error("Conecte um repositório GitHub primeiro."), { status: 409 });
  if (connection.githubUser) await ensureGithubOAuthIdentity(userId);
  connection = githubConnections.get(userId);
  const { owner, repo, token } = connection;
  const [labelsResult, projectsResult] = await Promise.allSettled([
    githubApi("/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/labels?per_page=100", token),
    githubGraphql(connection, projectFieldsQuery, { owner, repo })
  ]);
  if (labelsResult.status === "rejected") throw labelsResult.reason;
  const labelResponse = labelsResult.value;
  if (!labelResponse.ok) throw Object.assign(new Error(await githubError(labelResponse)), { status: labelResponse.status });
  const labels = await labelResponse.json();
  let projects = [];
  let projectsError = "";
  if (projectsResult.status === "rejected") projectsError = projectsResult.reason.message || "Permissão Projects não concedida.";
  else {
    const repository = projectsResult.value && projectsResult.value.repository;
    if (!repository) projectsError = "Não foi possível consultar projetos deste repositório.";
    else {
      const projectMap = new Map();
      for (const project of repository.projectsV2.nodes || []) projectMap.set(project.id, project);
      const ownerNode = repository.owner;
      const ownerProjects = ownerNode && ownerNode.projectsV2 && ownerNode.projectsV2.nodes || [];
      for (const project of ownerProjects) projectMap.set(project.id, project);
      projects = Array.from(projectMap.values()).map((project) => ({
        id: project.id, title: project.title, number: project.number,
        statusField: (project.fields.nodes || []).find((field) => field.__typename === "ProjectV2SingleSelectField" && field.name.toLowerCase() === "status") || null,
        singleSelectFields: (project.fields.nodes || []).filter((field) => field.__typename === "ProjectV2SingleSelectField").map((field) => ({ id: field.id, name: field.name, options: field.options }))
      }));
    }
  }
  return { labels: Array.isArray(labels) ? labels.map(({ name, description, color }) => ({ name, description, color })) : [], projects, projectsError };
}

async function createGithubIssue(body, userId) {
  let connection = githubConnections.get(userId);
  if (!connection) throw Object.assign(new Error("Conecte um repositório GitHub antes de criar a issue."), { status: 409 });
  if (connection.githubUser) await ensureGithubOAuthIdentity(userId);
  connection = githubConnections.get(userId);
  const title = clean(body.title);
  const issueDescription = typeof body.body === "string" ? body.body.trim() : "";
  const requestedLabels = Array.isArray(body.labels) ? Array.from(new Set(body.labels.filter((label) => typeof label === "string").map((label) => label.trim()).filter(Boolean))).slice(0, 100) : [];
  if (!title) throw Object.assign(new Error("O título da issue é obrigatório."), { status: 400 });
  if (!issueDescription) throw Object.assign(new Error("O conteúdo da issue está vazio."), { status: 400 });
  const requester = users.find((user) => user.id === userId);
  const githubIdentity = githubOAuthIdentities.get(userId);
  const githubLogin = connection.githubUser || (githubIdentity && githubIdentity.login);
  const issueBody = issueDescription + "\n\n---\n**Aberta pela ferramenta por:** " + (requester ? requester.username : "Usuário autenticado") + (githubLogin ? " (GitHub: @" + githubLogin + ")" : "");
  const endpoint = "/repos/" + encodeURIComponent(connection.owner) + "/" + encodeURIComponent(connection.repo) + "/issues";
  const response = await githubApi(endpoint, connection.token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: title, body: issueBody, labels: requestedLabels })
  });
  if (!response.ok) {
    const message = await githubError(response);
    if (response.status === 401) githubConnections.delete(userId);
    throw Object.assign(new Error(message), { status: response.status === 401 ? 401 : response.status === 403 ? 403 : response.status === 404 ? 404 : 502 });
  }
  const issue = await response.json();
  const result = { number: issue.number, title: issue.title, url: issue.html_url, repository: connection.owner + "/" + connection.repo };
  let attachedLabels = Array.isArray(issue.labels) ? issue.labels.map((label) => label.name) : [];
  const missingLabels = requestedLabels.filter((label) => !attachedLabels.includes(label));
  if (missingLabels.length) {
    const labelsEndpoint = "/repos/" + encodeURIComponent(connection.owner) + "/" + encodeURIComponent(connection.repo) + "/issues/" + issue.number + "/labels";
    try {
      const labelsResponse = await githubApi(labelsEndpoint, connection.token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labels: missingLabels })
      });
      if (labelsResponse.ok) {
        const updatedLabels = await labelsResponse.json();
        attachedLabels = Array.isArray(updatedLabels) ? updatedLabels.map((label) => label.name) : attachedLabels;
      } else {
        result.labelsError = await githubError(labelsResponse);
      }
    } catch (error) {
      result.labelsError = error.message || "Não foi possível confirmar as labels aplicadas.";
    }
  }
  result.labels = attachedLabels;
  if (body.projectId) {
    try {
      const metadata = await githubOptions(userId);
      const project = metadata.projects.find((item) => item.id === body.projectId);
      if (!project) throw new Error("O projeto selecionado não está disponível para este token.");
      const added = await githubGraphql(connection, `mutation($projectId:ID!, $contentId:ID!) { addProjectV2ItemById(input:{projectId:$projectId, contentId:$contentId}) { item { id } } }`, { projectId: project.id, contentId: issue.node_id });
      const itemId = added.addProjectV2ItemById.item.id;
      result.project = project.title;
      if (body.statusOptionId) {
        const field = project.singleSelectFields.find((item) => item.id === body.statusFieldId && item.name.toLowerCase() === "status");
        if (!field || !field.options.some((option) => option.id === body.statusOptionId)) throw new Error("A coluna selecionada não pertence ao campo Status deste projeto.");
        await githubGraphql(connection, `mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $optionId:String!) { updateProjectV2ItemFieldValue(input:{projectId:$projectId, itemId:$itemId, fieldId:$fieldId, value:{singleSelectOptionId:$optionId}}) { projectV2Item { id } } }`, { projectId: project.id, itemId, fieldId: field.id, optionId: body.statusOptionId });
        result.status = field.options.find((option) => option.id === body.statusOptionId).name;
      }
    } catch (error) {
      result.projectError = error.message || "A issue foi criada, mas não foi possível adicioná-la ao projeto/status.";
    }
  }
  return result;
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:" + PORT);
  const pathname = url.pathname;
  const method = req.method;
  try {
    if (pathname.startsWith("/api/") && method !== "GET" && method !== "HEAD" && !sameOrigin(req)) return send(res, 403, { error: "Origem da solicitação não permitida." });
    if (pathname === "/api/auth/setup-status" && method === "GET") return send(res, 200, { setupRequired: users.length === 0, setupEnabled: !!process.env.ADMIN_SETUP_KEY });
    if (pathname === "/api/auth/setup" && method === "POST") {
      if (users.length) return send(res, 409, { error: "A configuração inicial já foi concluída." });
      if (!process.env.ADMIN_SETUP_KEY) return send(res, 503, { error: "Configure ADMIN_SETUP_KEY no ambiente do servidor para iniciar a conta administradora." });
      const body = await readBody(req);
      if (!constantTimeTextEqual(clean(body.setupKey), process.env.ADMIN_SETUP_KEY)) return send(res, 403, { error: "Chave inicial incorreta." });
      if (!validUsername(body.username) || !validPassword(body.password)) return send(res, 400, { error: "Use um usuário de 3 a 32 caracteres e uma senha de até 128 caracteres." });
      const credentials = await hashPassword(body.password);
      const admin = { id: randomUUID(), username: body.username, role: "admin", active: true, createdAt: Date.now(), ...credentials };
      users.push(admin); await saveUsers();
      const token = randomBytes(32).toString("base64url"); sessions.set(token, { userId: admin.id, expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
      res.setHeader("Set-Cookie", sessionCookie(req, token, 12 * 60 * 60));
      return send(res, 201, { user: safeUser(admin) });
    }
    if (pathname === "/api/auth/login" && method === "POST") {
      const body = await readBody(req);
      const user = users.find((item) => item.username.toLowerCase() === clean(body.username).toLowerCase() && item.active);
      if (!user || !await verifyPassword(typeof body.password === "string" ? body.password : "", user)) return send(res, 401, { error: "Usuário ou senha incorretos." });
      const token = randomBytes(32).toString("base64url"); sessions.set(token, { userId: user.id, expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
      res.setHeader("Set-Cookie", sessionCookie(req, token, 12 * 60 * 60));
      return send(res, 200, { user: safeUser(user) });
    }
    const session = sessionFor(req);
    if (pathname === "/api/auth/me" && method === "GET") return send(res, 200, session ? { user: safeUser(session.user) } : { user: null });
    if (pathname === "/api/auth/logout" && method === "POST") {
      const token = parseCookies(req.headers.cookie).automacao_session; const loggedOut = token && sessions.get(token); if (token) sessions.delete(token);
      if (loggedOut && !Array.from(sessions.values()).some((item) => item.userId === loggedOut.userId)) { githubConnections.delete(loggedOut.userId); githubOAuthIdentities.delete(loggedOut.userId); }
      res.setHeader("Set-Cookie", sessionCookie(req, "", 0)); return send(res, 200, { ok: true });
    }
    if (pathname === "/api/github/oauth/callback" && method === "GET") {
      if (!githubOAuthIsConfigured()) return send(res, 503, { error: "Configure a GitHub App no servidor antes de autorizar contas." });
      return await githubOAuthCallback(req, res, url);
    }
    if (pathname.startsWith("/api/") && !session) return send(res, 401, { error: "Faça login para continuar." });
    const userId = session && session.user.id;

    if (pathname === "/api/github/oauth/status" && method === "GET") {
      const identity = githubOAuthIdentities.get(userId);
      return send(res, 200, { available: githubOAuthIsConfigured(), connected: !!identity, githubUser: identity ? identity.login : "" });
    }
    if (pathname === "/api/github/oauth/start" && method === "GET") {
      if (!githubOAuthIsConfigured()) return send(res, 503, { error: "Configure GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET e GITHUB_APP_CALLBACK_URL no servidor." });
      const sessionToken = parseCookies(req.headers.cookie).automacao_session;
      const state = randomBytes(32).toString("base64url");
      githubOAuthStates.set(state, { sessionToken, userId, expiresAt: Date.now() + 10 * 60 * 1000 });
      for (const [oldState, pending] of githubOAuthStates) if (pending.expiresAt < Date.now()) githubOAuthStates.delete(oldState);
      const authorize = new URL("https://github.com/login/oauth/authorize");
      authorize.searchParams.set("client_id", process.env.GITHUB_APP_CLIENT_ID);
      authorize.searchParams.set("redirect_uri", process.env.GITHUB_APP_CALLBACK_URL);
      authorize.searchParams.set("state", state);
      res.writeHead(302, { "Location": authorize.toString(), "Cache-Control": "no-store" }); return res.end();
    }

    if (pathname === "/api/admin/users" && method === "GET") {
      if (session.user.role !== "admin") return send(res, 403, { error: "Somente administradores podem gerenciar contas." });
      return send(res, 200, { users: users.map(safeUser) });
    }
    if (pathname === "/api/admin/users" && method === "POST") {
      if (session.user.role !== "admin") return send(res, 403, { error: "Somente administradores podem gerenciar contas." });
      const body = await readBody(req);
      if (!validUsername(body.username) || !validPassword(body.password)) return send(res, 400, { error: "Use um usuário de 3 a 32 caracteres e uma senha de até 128 caracteres." });
      if (users.some((item) => item.username.toLowerCase() === body.username.toLowerCase())) return send(res, 409, { error: "Esse usuário já existe." });
      const credentials = await hashPassword(body.password);
      const user = { id: randomUUID(), username: body.username, role: body.role === "admin" ? "admin" : "user", active: true, createdAt: Date.now(), ...credentials };
      users.push(user); await saveUsers(); return send(res, 201, { user: safeUser(user) });
    }
    const userAdminMatch = pathname.match(/^\/api\/admin\/users\/([0-9a-f-]+)$/i);
    if (userAdminMatch && method === "PATCH") {
      if (session.user.role !== "admin") return send(res, 403, { error: "Somente administradores podem gerenciar contas." });
      const target = users.find((item) => item.id === userAdminMatch[1]); if (!target) return send(res, 404, { error: "Usuário não encontrado." });
      const body = await readBody(req);
      if (typeof body.active === "boolean") {
        if (!body.active && target.role === "admin" && users.filter((item) => item.role === "admin" && item.active).length < 2) return send(res, 409, { error: "Mantenha pelo menos um administrador ativo." });
        target.active = body.active;
        if (!target.active) { githubConnections.delete(target.id); githubOAuthIdentities.delete(target.id); for (const [token, item] of sessions) if (item.userId === target.id) sessions.delete(token); }
      }
      if (body.password !== undefined) {
        if (!validPassword(body.password)) return send(res, 400, { error: "A senha não pode ficar vazia e deve ter até 128 caracteres." });
        Object.assign(target, await hashPassword(body.password));
        for (const [token, item] of sessions) if (item.userId === target.id && token !== parseCookies(req.headers.cookie).automacao_session) sessions.delete(token);
      }
      if (body.role === "admin" || body.role === "user") {
        if (target.role === "admin" && body.role !== "admin" && users.filter((item) => item.role === "admin" && item.active).length < 2) return send(res, 409, { error: "Mantenha pelo menos um administrador ativo." });
        target.role = body.role;
      }
      await saveUsers(); return send(res, 200, { user: safeUser(target) });
    }

    if (pathname === "/api/github/status" && method === "GET") {
      const connection = githubConnections.get(userId);
      return send(res, 200, connection ? { connected: true, repository: connection.owner + "/" + connection.repo, repositoryUrl: connection.repositoryUrl, githubUser: connection.githubUser } : { connected: false });
    }
    if (pathname === "/api/github/connect" && method === "POST") return send(res, 200, await connectGithub(await readBody(req), userId));
    if (pathname === "/api/github/options" && method === "GET") return send(res, 200, await githubOptions(userId));
    if (pathname === "/api/github/disconnect" && method === "POST") { githubConnections.delete(userId); githubOAuthIdentities.delete(userId); return send(res, 200, { connected: false }); }
    if (pathname === "/api/github/issues" && method === "POST") return send(res, 201, await createGithubIssue(await readBody(req), userId));
    if (pathname === "/api/status" && method === "GET") {
      return send(res, 200, await aiStatus());
    }
    if (pathname === "/api/draft" && method === "POST") {
      const body = await readBody(req); const id = randomUUID();
      const job = { userId, status: "pending", createdAt: Date.now(), result: null, error: null }; draftJobs.set(id, job);
      for (const [jobId, oldJob] of draftJobs) if (Date.now() - oldJob.createdAt > 10 * 60 * 1000) draftJobs.delete(jobId);
      generate(body).then((result) => { job.status = "done"; job.result = result; }).catch((error) => { job.status = "error"; job.error = error.message || "Não foi possível falar com a IA local."; job.errorStatus = error.status || 503; });
      return send(res, 202, { jobId: id, status: "pending" });
    }
    const draftJobMatch = pathname.match(/^\/api\/draft\/jobs\/([0-9a-f-]+)$/i);
    if (draftJobMatch && method === "GET") {
      const job = draftJobs.get(draftJobMatch[1]);
      if (!job || job.userId !== userId) return send(res, 404, { error: "A geração expirou. Clique em Organizar para tentar novamente." });
      if (job.status === "pending") return send(res, 200, { status: "pending" });
      if (job.status === "error") return send(res, job.errorStatus || 503, { status: "error", error: job.error });
      return send(res, 200, { status: "done", ...job.result });
    }
    if (pathname.startsWith("/api/")) return send(res, 404, { error: "Rota não encontrada." });
    if (method !== "GET" && method !== "HEAD") return send(res, 405, { error: "Método não permitido." });
    let fileName;
    try { fileName = decodeURIComponent(pathname); } catch { res.writeHead(400); return res.end("URL inválida."); }
    if (fileName === "/") fileName = "/index.html";
    if (fileName !== "/index.html") { res.writeHead(404); return res.end("Não encontrado."); }
    const filePath = path.resolve(ROOT, "." + fileName);
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end("Acesso negado."); }
    fs.readFile(filePath, (error, data) => {
      if (error) { res.writeHead(404); return res.end("Não encontrado."); }
      const ext = path.extname(filePath).toLowerCase();
      const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };
      res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream", "Cache-Control": "no-store" });
      if (method === "HEAD") return res.end(); res.end(data);
    });
  } catch (error) { return send(res, error.status || 500, { error: error.message || "Erro interno do servidor." }); }
});

await initializeUsers();
server.listen(PORT, process.env.HOST || (process.env.RENDER ? "0.0.0.0" : "127.0.0.1"), () => {
  console.log("Automação de issues disponível na porta " + PORT);
  console.log(AI_PROVIDER === "cloudflare" ? "Workers AI: " + aiModel() : "Modelo local: " + OLLAMA_MODEL + " · Ollama: " + OLLAMA_BASE);
  console.log(users.length ? "Usuários cadastrados: " + users.length : "Configuração inicial: defina ADMIN_SETUP_KEY para criar a conta administradora.");
});




