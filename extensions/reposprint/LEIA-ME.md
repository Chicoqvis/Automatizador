# Extensão RepoSprint — versão 0.4.6

1. Abra chrome://extensions ou edge://extensions, ative Modo do desenvolvedor e use Carregar sem compactação.
2. No site, clique em Integrar com o RepoSprint, extraia o ZIP em uma pasta permanente e selecione a pasta reposprint que contém manifest.json. Para desenvolvedores, a pasta-fonte é extensions/reposprint.
3. Se já instalada, clique em Recarregar e aceite a nova permissão de acesso a api.reposprint.com se o navegador solicitar.
4. Faça login no RepoSprint uma vez no mesmo perfil do navegador. Depois pode fechar suas abas.
5. Na ferramenta, use Adicionar ao RepoSprint no histórico ou abra o ícone da extensão.
6. Confira workspace, repositório e número; clique em Buscar issue. Confira o resultado e confirme a inclusão.

A conexão agora ocorre diretamente na extensão. Nenhuma aba do RepoSprint é aberta automaticamente. O link Abrir RepoSprint só abre quando você clicar nele. Se a sessão expirar ou o acesso for recusado, entre novamente por esse link e retorne à extensão.

O workspace salvo vem selecionado mesmo sem abas abertas. Quando há abas abertas, os workspaces são agrupados sem duplicação. A busca procura o número exato nos primeiros 50 resultados; confirme o repositório, pois números podem se repetir.

Não solicita nem extrai cookies, senhas ou tokens. O navegador envia as credenciais da sessão ao próprio RepoSprint nas requisições. Nenhuma credencial é enviada ao servidor da ferramenta. O cookie exposto anteriormente deve ser invalidado encerrando a sessão e entrando novamente.

Protótipo baseado em chamadas internas sem suporte oficial confirmado. Cookies bloqueados, sessão expirada, permissões do workspace ou validação de origem pelo servidor podem impedir a conexão direta. Não há abertura automática como alternativa, nem alteração dessas proteções. Confira o backlog antes de repetir uma inclusão cuja resposta não foi confirmada.

Os testes usam API simulada; o funcionamento com sua conta real precisa ser testado após instalar/recarregar. Cada perfil e dispositivo precisa da extensão. Para remover, use Remover na página de extensões.

Versão 0.1.4: não há checkbox de confirmação. Após a busca, clique diretamente em Adicionar ao backlog. Resultados com repositório identificado diferente do solicitado continuam bloqueados.

## Priorizar backlog — versão 0.2.0

Após atualizar, recarregue a extensão e a página da ferramenta. O botão Priorizar backlog aparece no topo da ferramenta e também na janela da extensão. Abre um quadro da extensão, sem abrir o site RepoSprint.

O quadro consulta backlog.list e usa sprintTarget (out, active, future) para formar as colunas. Arraste dentro da mesma coluna ou use Subir/Descer. Salvar ordem envia backlog.reorder com todos os issueIds, preservando os cards de outras colunas. Descartar alterações restaura a ordem carregada. Movimentos entre colunas não são enviados.

Antes de salvar, a lista, as posições e as colunas são comparadas com uma nova consulta. Se mudou, descarte e atualize. Após enviar, a ordem é consultada e conferida novamente. Não há garantia atômica contra alterações simultâneas entre consulta e envio, pois o protocolo observado não possui revisão. Em falha ou resposta perdida, confira o RepoSprint antes de repetir. Não há repetição automática.

A sessão e as permissões do RepoSprint continuam necessárias. Testes automatizados utilizam API simulada; valide primeiro com uma pequena reorganização real. A ordem não altera fases, responsáveis, estados das issues ou associação a sprints.

## Controles dos cards — versão 0.3.0

Movimentações consulta backlog.issueHistory e mostra autor, data e posição anterior/nova. As posições são apresentadas começando em 1. Mover para oferece os demais destinos (out, active, future) e envia backlog.setSprintTarget. Remover do backlog pede confirmação em um diálogo da extensão e envia backlog.remove, sem excluir a issue GitHub.

Mover ou remover aplica imediatamente, verifica a lista antes e depois e atualiza o quadro. Ordens locais não salvas devem ser salvas ou descartadas antes dessas ações. Mudanças externas bloqueiam o envio até atualizar. Erros não são repetidos automaticamente. O histórico é carregado somente ao clicar. A confirmação do serviço e o resultado consultado determinam o sucesso; permissões e sessão continuam sendo as do RepoSprint.

Versão 0.3.5: atualizações são automáticas. O backlog é conferido a cada minuto enquanto visível e sem ordem pendente, arraste ou menu aberto. Salve ou descarte para retomar. O botão Atualizar backlog não aparece mais; a escolha do workspace também carrega os dados automaticamente.

## Processo Repo e aprovação de negócio — versão 0.4.0

Recarregue a extensão instalada nesta pasta e depois a página da ferramenta. No histórico, Processo Repo mostra a fase atual, o estado informado, o responsável e a data de entrada. Aprovação de negócio · Repo consulta todas as páginas do workspace selecionado na extensão, cruza as fases atuais e oferece Somente criadas por mim, usando o login verificado da conta GitHub conectada. Tasks de qualquer repositório do workspace podem aparecer; tasks sem fase informada não são presumidas como aprovação.

A consulta usa somente GET em issue.list e process.lifecycle.phaseSummaries. Não utiliza o marco aprovacao_negocio:ainda_falta como substituto da fase atual. Atualiza a cada três minutos com a ferramenta aberta e visível; não é um webhook nem um monitor com o navegador fechado. O servidor não recebe cookies ou credenciais RepoSprint.

Para tasks abertas criadas pela conta GitHub conectada, a fase business_approved pendente gera aviso no sino e pendência na categoria REPO. Avisos e leituras ficam persistidos por conta da ferramenta e workspace. A primeira consulta também inclui as aprovações existentes. A mesma entrada na fase não gera aviso repetido; uma nova data de entrada pode gerar outro aviso. A pendência anterior é concluída após uma consulta completa confirmar a saída; falhas de consulta e fases desconhecidas preservam o estado anterior. O botão de marcar avisos como lidos não resolve a pendência. Limpar notificações de comentários mantém os avisos REPO.

Não há ações de Aprovar análise, Solicitar ajuste ou Devolver para Análise nesta versão. O resumo de fases também não informa os privilégios e motivos específicos de bloqueio. O link para a issue permite consultar e agir no RepoSprint. As chamadas internas continuam sujeitas às permissões e à sessão da conta RepoSprint; os testes usam respostas simuladas.

Versão 0.4.1: a caixa Somente criadas por mim tem 16 × 16 px e fica alinhada ao texto. Processo Repo consulta apenas a issue escolhida. A consulta geral compartilha cache entre abas e espaça as requisições em pelo menos 1,5 segundo. Respostas de limite de acesso respeitam Retry-After e retomam somente consultas de leitura, sem repetir ações de alteração. Recarregue a extensão e depois a ferramenta.

Versão 0.4.2: Processo Repo reutiliza o cache por issue durante um minuto, inclusive entre abas e reinícios da extensão. Ao atualizar uma issue cujo ID já é conhecido, consulta somente sua fase. As consultas individuais têm prioridade sobre a fila geral, preservando o espaçamento e as pausas do RepoSprint. Dados anteriores continuam visíveis enquanto uma atualização é necessária. Recarregue a extensão e a ferramenta.

Versão 0.4.3: a ferramenta restaura o cache ao abrir e recebe resultados progressivamente, página por página, sem esperar a varredura do workspace terminar. Aprovação de negócio tem uma consulta própria de candidatos por marco, sempre conferindo a fase atual; ela inclui todos os autores por padrão. Somente criadas por mim continua opcional. Consultas parciais não resolvem pendências. O primeiro acesso sem cache depende da rede e dos limites do RepoSprint. Recarregue a extensão e a ferramenta.

Versão 0.4.4: a lista começa pelas fases já presentes em backlog.list e depois completa a consulta de candidatos. Resultados iniciais não presumem o autor GitHub; ele é conferido na listagem de issues. Limites de acesso retornam uma pausa imediatamente, sem manter o popup preso a várias tentativas. A ferramenta verifica a versão da extensão e orienta a recarga quando está incompatível, em vez de esperar por uma resposta que a versão anterior não suporta.

Versão 0.4.5: fases puladas ou canceladas não são aprovações pendentes. A consulta reutiliza fases do backlog, evitando consultar novamente os mesmos IDs. Responder abre o editor de comentários GitHub; a referência do repositório é conferida em issue.detail quando ainda não está disponível. Essa ação não aprova nem avança a fase. O contador mostra somente as tasks pendentes da seleção; a lista permanece visível durante a atualização em segundo plano.

Atualização da interface: Responder na lista de aprovação agora abre um painel próprio com Sua aprovação da análise e Devolver (retrabalho), em vez dos comentários GitHub. A nota é guardada por conta, workspace e issue neste navegador. Copiar nota e Abrir aprovação no RepoSprint permitem continuar a aprovação lá. Aprovar análise, Solicitar ajuste e Devolver para Análise permanecem desativados enquanto seus protocolos não estiverem disponíveis. Nenhuma decisão ou nota é enviada automaticamente.


### Devolver para Análise — versão 0.4.6

Recarregue a extensão em chrome://extensions e depois recarregue o site. O botão agora abre a justificativa e a confirmação de devolução. A extensão consulta process.lifecycle.get, confere que Análise está em returnTargets e envia uma única chamada processWorkflow.advance com toNodeKey analyzed e justification. Não envia isOverride nem repete escritas automaticamente. As permissões são aplicadas pelo RepoSprint; recusas não geram confirmação de sucesso. Uma nova consulta verifica a fase após o envio. Aprovar análise e Solicitar ajuste continuam indisponíveis nesta interface.
