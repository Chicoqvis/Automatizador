# Automação de issues

O servidor Node.js usa Ollama por padrão para manter a execução local. Para usar Cloudflare Workers AI, o app Node.js encaminha a geração para um Worker privado com binding `AI`; autenticação, sessões, dados e integração com GitHub continuam no servidor Node.js.

## Execução local com Ollama

Requer Node.js e Ollama. O modelo padrão é `qwen3:1.7b`.

```powershell
ollama pull qwen3:1.7b
node server.mjs
```

Abra `http://localhost:4173`. Para trocar o modelo, defina `OLLAMA_MODEL` antes de iniciar o servidor.

## Cloudflare Workers AI

1. Instale e autentique o Wrangler (`npx wrangler login`).
2. Defina um segredo compartilhado forte, sem o prefixo `Bearer`:

   ```powershell
   $secret = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
   $secret | npx wrangler secret put APP_SHARED_SECRET
   ```

3. Publique o Worker:

   ```powershell
   npx wrangler deploy
   ```

4. Configure o servidor Node.js que hospeda o app para usar o URL publicado do Worker e o mesmo segredo:

   ```powershell
   $env:AI_PROVIDER = 'cloudflare'
   $env:CLOUDFLARE_AI_URL = 'https://automacao-issues-ai.<sua-conta>.workers.dev'
   $env:CLOUDFLARE_AI_TOKEN = $secret
   node server.mjs
   ```

O modelo padrão é `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. Para escolher outro modelo compatível com JSON Mode, defina `CLOUDFLARE_AI_MODEL` no ambiente do servidor e em `wrangler.toml` antes de publicar.

O segredo `APP_SHARED_SECRET` deve ser configurado também como variável `CLOUDFLARE_AI_TOKEN` no ambiente de produção do servidor Node.js. Não o coloque em `index.html` nem em repositório público. Para desenvolvimento local do Worker, use `npx wrangler secret put APP_SHARED_SECRET` no ambiente remoto; o Ollama permanece independente e é o provedor padrão.

## Dados e privacidade

No modo Cloudflare, o relato enviado para gerar o rascunho é processado pelo Workers AI da conta Cloudflare configurada. Não inclua dados pessoais ou identificáveis de pacientes. A autenticação, os usuários e as conexões do GitHub continuam usando o armazenamento em arquivo e a memória do servidor Node.js; este Worker não substitui o servidor da aplicação.
