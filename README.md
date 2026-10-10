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

Para a integração GitHub, o usuário pode conectar um token pessoal pela interface. No Worker, o token fica criptografado no D1 por usuário; a interface não o grava no armazenamento do navegador. A caixa de lembrança salva somente o nome do repositório neste dispositivo. OAuth da GitHub App permanece opcional e precisa das variáveis `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` e `GITHUB_APP_CALLBACK_URL` como secrets do Worker; o callback deve terminar em `/api/github/oauth/callback`.

Veja [MANUAL_GITHUB.md](MANUAL_GITHUB.md) para orientar usuários a criar um token pessoal e localizar o repositório.

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

## Imagens e vídeos nos campos

Conecte o repositório GitHub e use **Anexar imagem ou vídeo** nos campos de contexto e descrição. Também é possível colar um print ou arrastar arquivos para o campo. A ferramenta envia o arquivo ao GitHub usando a conexão do usuário e mostra uma prévia. O link é incluído automaticamente na seção correspondente ao criar a issue.

Formatos: PNG, JPG, JPEG, GIF, WEBP, MP4, WEBM e MOV; até 10 MB por arquivo. O upload exige acesso de escrita ao repositório e permissões suficientes no token. A reprodução de vídeos depende do formato e dos codecs aceitos pelo navegador.

Os links dos anexos ficam salvos no rascunho deste navegador. Remover um anexo do campo retira sua referência do rascunho; não apaga o arquivo já enviado ao GitHub. Os anexos não são enviados para análise pela IA.

A implementação utiliza o mesmo endpoint de anexos empregado pelo [GitHub CLI](https://github.com/cli/cli/blob/trunk/internal/attachments/client.go).

## Revisão, IA por campo e rascunhos por conta

- **Prévia da issue:** ao clicar em Criar issue, revise título, labels, projeto/status, texto e anexos. Voltar e editar não envia nada. A issue é enviada somente em Confirmar e criar issue.
- **Issues semelhantes:** a prévia consulta títulos no repositório conectado, incluindo issues abertas e fechadas. Correspondências são aproximadas; não substituem a revisão humana. Se houver correspondências, pesquisa limitada ou erro de consulta, marque que revisou o aviso antes de continuar.
- **Refazer este campo com IA:** regenera apenas o campo escolhido, usando o relato e os outros campos como contexto, preservando os demais campos e anexos. Uma edição feita no campo durante a geração é preservada.
- **Rascunhos da minha conta:** Salvar na conta cria ou atualiza um rascunho; Salvar como novo cria outra cópia. Abra, atualize a lista ou exclua rascunhos. Inclui relato, campos, classificação, anexos e seleções do GitHub; labels/projeto só são restaurados quando o repositório conectado corresponde ao salvo. A conexão GitHub e seus tokens não são armazenados no rascunho. O salvamento é explícito: clique novamente em Salvar na conta após editar. O rascunho aberto também continua salvo localmente neste navegador.

No Cloudflare, aplique `npx.cmd wrangler d1 migrations apply automatizador-db --remote` antes de publicar a versão com a tabela de rascunhos. Os registros são isolados por usuário e protegidos contra sobrescrita por versões antigas. No servidor local, os rascunhos ficam em `data/drafts.json` (ignorado pelo Git).

Validação da persistência e busca: `node --test tests/workflow.test.mjs` (Node.js 24).

## Desfazer IA e pesquisar o histórico

O botão **Desfazer IA** recupera a alteração anterior aplicada pela IA, incluindo gerações completas e de um único campo. Mantém até 20 alterações na sessão atual. Se o usuário editou depois um campo que será restaurado, pede confirmação. Os anexos não são alterados. Abrir outro rascunho, apagar o formulário ou recarregar encerra essa sequência de desfazer.

O **Histórico de issues** permite combinar pesquisa de título ou número, repositório e intervalo de datas. Os filtros consideram a data de criação registrada no navegador. **Limpar filtros** exibe novamente os registros; **Limpar** apaga somente o histórico local, sem excluir issues do GitHub. São mantidos até 200 registros por conta neste navegador; registros antigos já descartados pelo limite anterior não são recuperados.

Os campos com **Refazer este campo com IA** também têm **Desfazer IA** ao lado, para restaurar apenas a alteração anterior daquele campo e preservar o restante do rascunho. O botão geral continua permitindo desfazer as alterações restantes de uma geração completa. Os botões de refazer e anexar têm tamanho alinhado, incluindo no celular.

## Orientação ao refazer e histórico sincronizado

Ao clicar em **Refazer este campo com IA**, informe opcionalmente como melhorar o texto. A janela oferece exemplos e aceita uma orientação de até 2.000 caracteres. Somente o campo escolhido é atualizado; desfazer continua disponível.

As novas issues criadas pela ferramenta são registradas automaticamente no histórico da conta. Acesse em outro dispositivo e use **Atualizar histórico** para consultar as últimas 500 issues registradas. As pesquisas por título/número, repositório e datas continuam disponíveis. **Importar histórico deste navegador** permite trazer registros antigos locais para a conta; a importação preserva datas e não duplica uma mesma issue. **Limpar** apaga o histórico da conta em todos os dispositivos, sem apagar as issues no GitHub.

Antes de publicar esta versão, aplique `npx.cmd wrangler d1 migrations apply automatizador-db --remote` para criar `issue_history`. No servidor local, o histórico da conta fica em `data/issue-history.json`, ignorado pelo Git. Se a gravação do histórico falhar após criar uma issue, o usuário recebe um aviso e pode importar a cópia local; a issue não deve ser criada novamente.

## Memória automática por conta

Após criar uma issue, a ferramenta guarda o relato e o conteúdo revisado enviado ao GitHub em uma memória própria da conta autenticada. Não depende do usuário escolher uma issue anterior. Ao gerar ou refazer um campo, consulta somente memórias desse usuário; quando há repositório conectado, usa somente referências dele. A busca seleciona até três conteúdos relacionados entre as 250 memórias mais recentes, com contexto limitado para a IA. Uma geração pode não usar memória se não encontrar relação suficiente.

O relato atual tem prioridade. Referências antigas podem conter hipóteses ou regras desatualizadas e não são tratadas como instruções nem como prova de que uma melhoria foi implementada. A interface indica quais referências foram usadas. Imagens e vídeos não são analisados por esse mecanismo: a memória guarda o texto e as referências de anexos.

**Apagar memória da minha conta** remove somente a memória da conta conectada, preservando issues, histórico, rascunhos e outras contas. A memória começa com as novas issues criadas após esta atualização; o histórico antigo, que guarda apenas metadados, não é usado para reconstruir conteúdo automaticamente. Se a gravação falhar depois de criar uma issue, a ferramenta mostra um aviso, sem induzir uma nova criação.

Cloudflare: aplique a migração `0004_account_memory.sql` antes de publicar. No modo local, o conteúdo fica em `data/account-memory.json`, ignorado pelo Git. Conteúdo relevante recuperado da memória é enviado ao provedor de IA configurado junto ao relato atual; isso não treina o modelo.

## Cotas diárias disponíveis

Apenas administradores podem abrir o painel e consultar `GET /api/admin/quotas`; usuários comuns recebem HTTP 403. Aplique `0005_daily_usage.sql` antes de publicar. Os contadores persistem no D1 e são compartilhados entre todos os usuários do site. O saldo é uma estimativa do plano Free, não uma consulta do saldo global da conta Cloudflare: não inclui consumo anterior à implantação ou de outros projetos, requisições bloqueadas pela plataforma e operações feitas diretamente no painel. A renovação diária ocorre às 00:00 UTC (21h de Brasília). Os contadores são separados pela data UTC de início da requisição.

A IA usa os tokens retornados pelo modelo Llama 3.3 70B e os coeficientes públicos de neurônios para estimar o consumo. Se os tokens não forem retornados ou o modelo não tiver coeficientes conhecidos, mostra saldo indisponível; nunca trata uma chamada desconhecida como gratuita. Uma resposta de cota esgotada confirma saldo zero para o dia. Leituras e gravações do banco usam os metadados das consultas, incluindo uma estimativa da própria gravação do contador. Cada requisição ao Worker grava uma atualização atômica no contador (uma linha), consumindo também a cota do D1. Nenhum relato, memória ou dado pessoal é copiado para esses contadores.

O botão Atualizar cotas consulta os dados sem polling contínuo. O modo local apenas informa que o painel está disponível no site publicado. O armazenamento total de 5 GB não é uma cota diária e não aparece neste painel.