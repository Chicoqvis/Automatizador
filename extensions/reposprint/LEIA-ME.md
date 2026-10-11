# Extensão RepoSprint — versão 0.1.3

1. Abra chrome://extensions ou edge://extensions, ative Modo do desenvolvedor e use Carregar sem compactação.
2. Selecione C:\Users\francisco.viana\Documents\GitHub\Automatizador\extensions\reposprint.
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
