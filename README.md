# Automação de issues

Há duas versões independentes:

- **Local:** servidor Node.js e Ollama; continua funcionando com `node server.mjs`.
- **Pública:** Cloudflare Workers com Workers AI e D1 para usuários, sessões e conexões GitHub.

## Execução local com Ollama

Requer Node.js e Ollama. O modelo padrão é `qwen3:1.7b`.

```powershell
ollama pull qwen3:1.7b
node server.mjs
```

Abra `http://localhost:4173`. Para trocar o modelo, defina `OLLAMA_MODEL` antes de iniciar o servidor.

## Publicar a versão gratuita no Cloudflare

O Worker serve a interface e as rotas da aplicação. Os relatos são enviados diretamente ao binding Workers AI. D1 mantém as contas e sessões entre reinicializações.

1. Instale/autentique o Wrangler (`npx.cmd wrangler login`) e crie o banco:

   ```powershell
   npx.cmd wrangler d1 create automatizador-db
   ```

   Copie o `database_id` que o comando mostrar e substitua `REPLACE_AFTER_CREATING_D1` em `wrangler.toml`.

2. Aplique a migração ao banco remoto:

   ```powershell
   npx.cmd wrangler d1 migrations apply automatizador-db --remote
   ```

3. Configure a chave para criar a primeira conta administradora e a chave que criptografa os tokens GitHub:

   ```powershell
   $adminSetupKey = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
   $adminSetupKey | npx.cmd wrangler secret put ADMIN_SETUP_KEY
   $githubKey = node -p "require('node:crypto').randomBytes(32).toString('base64url')"
   $githubKey | npx.cmd wrangler secret put GITHUB_TOKEN_ENCRYPTION_KEY
   ```

   Guarde `adminSetupKey` para a primeira configuração. Não publique essas chaves no repositório. A chave GitHub precisa permanecer igual; perder ou trocar essa chave impede a descriptografia das conexões GitHub já salvas.

4. Publique o Worker e os arquivos da interface:

   ```powershell
   npx.cmd wrangler deploy
   ```

   O endereço será `https://automacao-issues-ai.<subdominio-da-conta>.workers.dev`. Acesse-o e use `adminSetupKey` no formulário para criar a conta administradora.

O modelo padrão é `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. O arquivo `cloudflare-ai-worker.mjs` é o proxy antigo de IA; o `wrangler.toml` agora publica `cloudflare-app-worker.mjs` como aplicação completa.

Para a integração GitHub, o usuário pode conectar um token pessoal pela interface. OAuth da GitHub App permanece opcional e precisa das variáveis `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` e `GITHUB_APP_CALLBACK_URL` como secrets do Worker; o callback deve terminar em `/api/github/oauth/callback`.

## Dados e privacidade

No modo público, relatos são processados pelo Workers AI da conta Cloudflare. Tokens GitHub são criptografados antes de serem guardados no D1. Não inclua dados pessoais ou identificáveis de pacientes. A versão local continua usando Ollama e `data/users.json`.

### Antes de enviar ao GitHub

Não envie `users.json`, `data/users.json`, `wrangler-account.json`, arquivos `.env*` ou `.dev.vars`. Se algum deles já estiver rastreado pelo Git, remova-o do próximo commit sem apagar sua cópia local:

```powershell
git rm --cached --ignore-unmatch users.json data/users.json wrangler-account.json
git add .gitignore README.md wrangler.toml public/index.html migrations/0001_initial.sql
git status --short
```

Revise a saída de `git status` antes de fazer o commit. A remoção do próximo commit não apaga esses arquivos do histórico anterior do repositório; como `users.json` contém hash e salt de senha, remova-o também do histórico e troque a senha da conta se ele continha uma conta real.
