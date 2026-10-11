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
