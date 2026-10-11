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

O botão Atualizar cotas consulta os dados sob demanda. Enquanto um administrador está com a página visível, os alertas também consultam o consumo a cada 60 segundos e após operações, com intervalo mínimo de 15 segundos. Essas consultas consomem requisições e operações do D1. O modo local apenas informa que o painel está disponível no site publicado. O armazenamento total de 5 GB não é uma cota diária e não aparece neste painel.
## Revisão de memória e recuperação de falhas

Memória da minha conta permite pesquisar as 500 referências mais recentes, ler o conteúdo e excluir uma única memória com confirmação. As rotas GET /api/memory/entries e GET/DELETE /api/memory/entry filtram sempre pelo usuário autenticado, incluindo administradores. Excluir não altera GitHub, histórico ou rascunhos; a referência sai das próximas gerações, mas uma geração já em andamento pode ter carregado o texto antes da exclusão.

Falhas de IA oferecem Tentar IA novamente e preservam a orientação de revisão do campo. Anexos com falha ficam retidos em memória nesta aba para reenvio ou descarte; não sobrevivem ao fechamento ou recarregamento. A criação de issues fica bloqueada até tratar esses anexos.

Envios ao GitHub guardam uma tentativa por conta no navegador, incluindo texto, seleção e identificador aleatório. Aplique 0006_issue_operations.sql antes de publicar. O servidor registra o identificador e uma impressão SHA-256 do conteúdo, com resultado e estado, evitando POSTs repetidos. Um comentário HTML invisível na issue permite recuperar uma criação cuja resposta se perdeu. Em caso de entrega incerta, a ferramenta consulta as issues recentes (até 500) e não faz um novo POST se não puder confirmar o resultado. Falhas com rejeição explícita 4xx podem ser tentadas novamente com o mesmo identificador. Uma issue já criada é retornada, com aviso para conferir labels/projeto se a conclusão dessas etapas for desconhecida. Recuperar uma tentativa já concluída não recria uma memória que o usuário excluiu. O histórico pode ser novamente sincronizado.

No servidor local, o registro fica em data/issue-operations.json. As tentativas não contêm tokens; os arquivos em data continuam ignorados pelo Git. O repositório e o conteúdo original precisam permanecer iguais ao recuperar. Descartar a tentativa no navegador não cancela uma operação em andamento nem apaga uma issue.

Alertas administrativos aparecem em 80% e 95% do consumo estimado, mostrando apenas o nível mais alto atingido; ao esgotar, indicam cota atingida. A renovação remove os alertas na próxima consulta. Métricas sem saldo calculável não geram um percentual inventado.
## Acompanhamento das issues no histórico

O histórico mostra Aberta, Fechada ou Status ainda não consultado, com data da última verificação e aviso se a consulta falhou. O estado da issue (issueState) é independente da coluna do projeto (status). Novas issues já registram o estado retornado na criação. Importações antigas começam sem status verificado.

Atualizar status no GitHub consulta apenas issues presentes no histórico da conta autenticada e pertencentes ao repositório atualmente conectado. Para outro repositório, conecte-o e repita a atualização. As consultas são somente de leitura no GitHub, em lotes de até 25 issues e com quatro chamadas simultâneas; não há consulta automática de status ao abrir a página. Resultados persistem no D1 ou no arquivo de histórico local, ficando disponíveis nos outros dispositivos. Uma falha preserva o último estado conhecido; 404 não significa issue fechada. Atualizar histórico apenas carrega os dados já salvos na conta.

A consulta utiliza as permissões e limites do token GitHub conectado e consome chamadas da ferramenta. Não precisa de migração: os novos campos ficam no JSON do histórico. Recuperar um envio já concluído não sobrescreve um status mais recente do histórico.
## Filtros, edição, pendências e resumo de uso

O filtro Status da issue combina abertas, fechadas e não consultadas com pesquisa, repositório e datas. Limpar filtros remove todas essas seleções. Os itens do checklist são botões acessíveis por teclado que levam ao campo correspondente e o colocam em foco.

Editar issue abre os textos atuais do GitHub a partir de um registro do histórico da conta. Exige conectar o mesmo repositório. Título e conteúdo são editáveis; labels, projeto e estado não são enviados no PATCH. A prévia exige confirmação específica de atualização e não pesquisa duplicidade, pois não cria uma issue nova. O servidor compara uma impressão do título e corpo com a versão aberta antes de enviar: se alguém alterou o conteúdo, retorna conflito. Uma tentativa cuja resposta se perdeu pode ser repetida; se o texto desejado já estiver aplicado, não envia outro PATCH. Essa comparação não é uma transação atômica com o GitHub; alterações externas entre a última consulta e o PATCH ainda podem ocorrer.

O rascunho de edição fica no navegador, separado por conta, repositório e número. Fechar mantém alterações pendentes. Recarregar versão do GitHub requer confirmação para substituir o rascunho. Uma atualização bem-sucedida sincroniza o título no histórico e revisa a memória correspondente somente se ela ainda existir, sem recriar uma memória excluída. Falhas na sincronização local são informadas separadamente da atualização já realizada no GitHub.

Resumo de uso é exclusivo de administradores (UI e GET /api/admin/usage), com os registros dos últimos 14 dias em UTC. Aplique 0007_daily_issue_count.sql antes da publicação. Criações reais são contadas ao receber a resposta de criação do GitHub; recuperar o mesmo envio não incrementa novamente, e editar não conta como criação. Chamadas à IA passam a contar tentativas, inclusive falhas, ao iniciar a operação. Antes desta atualização, ai_calls registrava somente respostas concluídas; issues_created não era registrado. Não é possível reconstruir esses números de forma completa a partir de um histórico que pode ter sido apagado. As estatísticas são agregadas, sem relatórios por usuário nem cópia de relatos, e seguem os registros da ferramenta, não o consumo global da conta Cloudflare. O modo local mantém edição e filtros, mas o resumo de uso é consultado na versão publicada.

## Labels, comentários, projetos e repositórios salvos

O histórico oferece **Labels**, **Comentários** e **Projetos** para issues da própria conta e do repositório conectado. Labels são carregadas do GitHub e revisadas antes de substituir a seleção; alterações externas detectadas exigem reabrir a seleção. Comentários permitem leitura paginada e envio com prévia e confirmação. O texto pendente fica no navegador por conta, repositório e issue; tentativas repetidas usam o mesmo identificador e consultam o GitHub quando a entrega é incerta, evitando um novo envio sem confirmação do resultado. Comentários não são incorporados à memória da IA.

Na criação ou no histórico, é possível incluir uma issue em até cinco projetos por envio, escolhendo a coluna de cada projeto quando disponível. O resultado informa sucesso ou falha individualmente. Uma falha em um projeto não impede os demais nem apaga a issue criada. Selecionar um projeto novamente pode atualizar sua coluna; essa ação não remove outros projetos. O acesso depende das permissões do GitHub conectado.

**Repositórios salvos na minha conta** permite conectar novos repositórios e alternar entre os já autorizados. O formulário mantém os textos e limpa as seleções de labels e projetos para revisão no novo destino. Na Cloudflare, aplique a migração 0008_saved_repositories.sql: os acessos persistem por usuário, com tokens criptografados. A lista não expõe credenciais. Desconectar encerra a conexão ativa; remover dos salvos retira somente a entrada da lista. No servidor local, os acessos salvos ficam somente em memória e precisam ser reconectados após reiniciar; OAuth pode exigir nova autorização.

A pesquisa em **Memória da minha conta** também consulta o conteúdo, além de título, número e repositório, e mostra um trecho correspondente. O filtro ocorre antes do limite de 500 resultados, mantendo o isolamento entre contas. A seleção automática de referências pela IA continua com seus limites próprios.

## Sino de comentários

O sino consulta novos comentários nas issues do histórico da conta, usando os repositórios salvos e suas credenciais autorizadas. A verificação ocorre a cada dois minutos enquanto a página estiver visível, ao voltar à página e pelo botão Atualizar. A primeira consulta estabelece o marco inicial sem alertar comentários antigos. Comentários posteriores podem ser encontrados ao reabrir o site no mesmo navegador. Repositórios sem acesso válido mostram aviso sem impedir a consulta dos demais.

O contador indica avisos não lidos; abrir o link marca aquele aviso, e Marcar todas como lidas limpa o contador. A caixa guarda até 500 avisos na conta, com leituras sincronizadas entre dispositivos. Não envia notificações com o site fechado. Cada ciclo faz uma consulta da lista e uma página de comentários por repositório com issues próprias; páginas adicionais continuam nas próximas verificações. As consultas consomem requisições da ferramenta e da API GitHub. Editar um comentário antigo não gera aviso de comentário novo.

Editar issue, Labels, Comentários e Projetos usam botões de 105 × 34 px, em quatro colunas quando houver espaço e duas no celular.

## Sugestão de resposta nos comentários

No histórico, abra Comentários e clique em Sugerir resposta com IA. Uma orientação opcional de até 2.000 caracteres pode indicar o objetivo da resposta. A ferramenta consulta o título, a descrição e os comentários recentes diretamente no GitHub, usando somente issues do histórico da conta e do repositório conectado. Não consulta memórias de outras issues nem publica automaticamente. O resultado preenche Novo comentário; o envio continua exigindo revisão e confirmação. Substituir texto existente pede confirmação, falhas preservam o texto, e uma tentativa de envio pendente precisa ser resolvida antes de gerar outra resposta.

O contexto usa até os 50 comentários mais recentes, com até 20.000 caracteres no conjunto e 4.000 por comentário, além de até 16.000 caracteres da descrição. A interface informa quando esses limites cortam conteúdo. Imagens e vídeos não são analisados. O prompt orienta a não inventar fatos, prazos ou implementação e a pedir esclarecimento quando faltar informação. A resposta precisa ser conferida pelo usuário. A geração consome a cota normal de IA, conta no resumo de uso e mantém o aviso de cota diária esgotada. Não há nova migração de banco.
Cada notificação também oferece Comentar para abrir a conversa dentro da ferramenta, marcar o aviso como lido e usar a sugestão de resposta com IA. Quando necessário, conecta o repositório salvo correspondente, mantendo os textos do formulário e pedindo revisão das seleções no novo destino. Operações e anexos pendentes precisam ser resolvidos antes de alternar.


## Notificações por conta e controle de memória

Aplique 0009_notifications_memory_controls.sql antes de publicar. Os avisos, suas leituras e o marco de consulta de cada repositório ficam no D1 por usuário. Novos dispositivos carregam o mesmo histórico de até 500 avisos e a mesma situação de leitura. Marcar como lida altera somente a conta autenticada. A página consulta a cada dois minutos enquanto visível; o servidor compartilha os marcos entre dispositivos e evita consultar novamente um repositório em menos de 30 segundos após uma verificação bem-sucedida. A sincronização não adiciona notificações push com a página fechada. O modo local persiste em data/notifications.json, ignorado pelo Git.

O histórico sincronizado começa nos comentários posteriores à ativação desta versão em cada repositório; avisos antigos guardados apenas no navegador não são importados. Os acessos ao GitHub continuam separados por conta.

Memória da minha conta mostra Ativa, Desativada e Desatualizada. Desativar/Reativar altera a disponibilidade; marcar como desatualizada/atualizada altera a validade da referência. Somente memórias ativas e atualizadas entram no contexto das próximas gerações. Ambos os estados persistem por conta e entre dispositivos. O conteúdo, a issue e o histórico são preservados; editar a issue não remove esses estados. Uma geração já iniciada pode ter carregado a referência antes da mudança.

## Responder a um comentário específico

Cada mensagem na conversa tem Responder. O botão seleciona a mensagem e solicita uma sugestão de IA focada nela, mantendo a descrição e os comentários recentes como contexto. O servidor carrega o comentário selecionado diretamente do GitHub e verifica se ele pertence à issue do histórico da conta. Mesmo mensagens antigas, fora do recorte recente, podem ser o foco; seu texto é limitado a 8.000 caracteres. A sugestão inclui uma referência com link para o comentário original. O GitHub recebe um comentário normal na conversa, com essa referência, após revisão e confirmação. Nada é enviado ao clicar em Responder.

O foco fica indicado acima do campo e pode ser cancelado. Comentário pendente e foco são guardados juntos no navegador. Substituir um texto existente pede confirmação, e uma tentativa de envio pendente precisa ser resolvida antes de mudar o foco. Usa a mesma cota de IA da sugestão geral.

## Editar, excluir e comentar diretamente

COMENTAR substitui Revisar comentário e envia diretamente o texto, sem prévia intermediária. Mantém identificação da tentativa, proteção contra duplicação e preservação do texto em falhas. Sugestões de IA continuam apenas preenchendo o campo: o usuário precisa clicar em COMENTAR para publicar.

Cada mensagem oferece Editar e Excluir. Editar abre o texto no próprio comentário e Salvar alteração aplica a mudança, mantendo o marcador interno de recuperação quando existir. Excluir pede confirmação por ser uma ação irreversível. O servidor valida o histórico da conta, o repositório conectado e a origem do comentário, compara a revisão carregada e deixa o GitHub verificar as permissões. Um conflito exige atualizar a conversa; falhas preservam o texto da edição na janela aberta. A comparação não é atômica com o GitHub. Repetir uma edição já aplicada não envia outro PATCH; excluir um comentário já ausente não faz nova exclusão. Essas ações não alteram a memória da IA.

## Notificações direcionadas, edição e anexos nos comentários

Os nomes passam a Comentar e Manual de como gerar o token. As notificações permitem combinar Todas/Somente não lidas com o repositório, sem alterar o contador global de avisos não lidos.

Comentar em uma notificação abre a conversa e destaca a mensagem de origem como Comentário desta notificação. O comentário é consultado por seu identificador, mesmo quando não está na primeira página; aparece destacado no início da conversa, sem duplicação ao carregar as páginas seguintes. Se ele foi excluído ou não estiver disponível, mostra aviso e mantém a conversa acessível. Mensagens com updated_at posterior a created_at indicam Editado em, conforme os metadados do GitHub.

Novo comentário aceita Anexar imagem ou vídeo, Ctrl+V e arrastar arquivos, com limite de 10 MB por arquivo e os mesmos formatos dos campos da solicitação. Os links são inseridos no texto e exibidos em prévia; o upload verifica o repositório da issue. Arquivos com falha ficam retidos na janela aberta para reenvio ou descarte, bloqueando Comentar até serem resolvidos. Fechar ou recarregar perde arquivos ainda não enviados; os links já inseridos ficam no rascunho local do comentário. Uploads não publicam o comentário: o envio ocorre ao clicar em Comentar. A IA continua sem analisar imagens ou vídeos.
A edição de comentários também oferece Anexar imagem ou vídeo, Ctrl+V e arrastar arquivos, com prévia e limite de 10 MB. O upload insere os links no texto editado; a mensagem só é alterada ao clicar em Salvar alteração. Arquivos com falha bloqueiam o salvamento até reenvio ou descarte. Cancelar edição descarta o texto editado e os arquivos pendentes daquela edição, preservando o comentário publicado.

## Pop-ups no computador

Dentro do sino, Ativar notificações no computador solicita a permissão do navegador mediante clique do usuário e mostra um aviso de ativação. Desativar notificações no computador interrompe novos pop-ups sem alterar o sino, as leituras ou a lista sincronizada. A preferência é por conta neste navegador; a permissão pertence ao site e ao navegador. Se bloqueada, a interface orienta liberar nas configurações do site.

Com o site aberto e a opção ativa, a consulta de comentários continua em abas em segundo plano, sujeita aos atrasos e suspensão de timers do navegador. Novos avisos geram notificações nativas do sistema; o Windows/navegador controla posição, duração e eventual bloqueio por Não perturbe. Clique no aviso abre a conversa com o comentário de origem destacado. Muitos avisos recebidos juntos são agrupados e abrem o sino. A primeira sincronização ao abrir a página não gera uma sequência de pop-ups de avisos antigos. Uma lista por conta no navegador e Web Locks, quando disponível, evitam alertar o mesmo comentário em várias abas. Não há push quando o site está fechado nem mudança de planos da Cloudflare.

## Minhas pendências por menção e identidade dos comentários

Aplique 0010_pending_mentions.sql antes de publicar. Minhas pendências registra somente novos comentários nas issues do histórico da conta que mencionem o login GitHub verificado pelo token do repositório salvo. Exemplo: @chicoqvis. A comparação ignora maiúsculas e minúsculas, verifica o conteúdo completo antes do recorte do aviso e não confunde usuários com nomes semelhantes, e-mails ou trechos de código/comentários HTML. Comentários sem essa menção continuam no sino, mas não entram nas pendências. A detecção acompanha o mesmo ciclo de consulta das notificações; comentários antigos não são importados retroativamente.

O painel permite ver pendentes, resolvidas ou todas, responder ao comentário de origem, marcar como resolvido e reabrir uma pendência. Ler ou responder não resolve automaticamente. Marcar como resolvido não fecha a issue. Pendências e estados persistem por conta no D1 e ficam disponíveis em outros dispositivos. São independentes do limite de retenção das notificações; o painel mostra até 500 registros, priorizando os pendentes. No modo local ficam em data/notifications.json, ignorado pelo Git.

A conversa mostra Comentando no GitHub como @login perto de Comentar. A identidade é consultada diretamente no GitHub, incluindo conexões por token pessoal; sem verificação, a ferramenta bloqueia o envio. Ao comentar, editar ou excluir, o servidor compara a conta esperada com a identidade do token, evitando enviar por uma conta trocada após abrir a conversa. Se a conta mudar, pede atualizar e conferir a identidade. Isso acrescenta consultas à API GitHub, sem enviar comentários automaticamente.
Limpar notificações fica ao lado do controle de pop-ups e pede confirmação. Remove os avisos da conta em todos os dispositivos, preservando issues, comentários e Minhas pendências. Os marcos de consulta permanecem, e um marco de limpeza impede que avisos anteriores reapareçam por consultas simultâneas ou paginação; comentários posteriores continuam gerando notificações normalmente. Não exige nova migração.
