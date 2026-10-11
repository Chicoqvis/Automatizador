# Instalação no Chrome ou Edge

1. Abra `chrome://extensions` (Chrome) ou `edge://extensions` (Edge).
2. Ative **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione esta pasta, onde está `manifest.json`:

   `C:\Users\francisco.viana\Documents\GitHub\Automatizador\extensions\reposprint`

4. Abra seu workspace em https://reposprint.com e faça login normalmente.
5. Recarregue a ferramenta de issues. No histórico, clique em **Adicionar ao RepoSprint**.
6. Na janela aberta, selecione a aba do workspace e clique em **Buscar issue**.
7. Confira a tarefa e o repositório. Se o serviço retornar somente o ID do repositório, abra **Conferir issue no RepoSprint** e verifique antes de marcar a confirmação.
8. Marque a confirmação e clique em **Confirmar inclusão no backlog**.

Também é possível abrir a extensão pelo ícone de extensões do navegador e informar o repositório e o número manualmente. Fixe o ícone para facilitar.

## Limites do protótipo

- Não solicita, lê ou armazena cookies, senhas ou tokens. A requisição acontece na aba do RepoSprint com sua sessão ativa e as permissões daquela conta.
- Não utiliza o cookie compartilhado anteriormente. Encerre a sessão exposta e entre novamente antes de testar.
- Não inclui nada automaticamente ao criar issues. Busca e inclusão dependem de cliques separados; não há repetição automática após erro.
- Usa chamadas internas observadas, sem suporte oficial confirmado. Pode exigir ajustes se o RepoSprint mudar seu protocolo, bloquear a requisição ou exigir validações adicionais.
- A busca verifica o número exato nos primeiros 50 resultados. Issues recém-criadas podem precisar aguardar sincronização. Vários repositórios podem ter o mesmo número.
- Em caso de erro ou resposta perdida, confira o backlog no RepoSprint antes de tentar novamente. A proteção contra duplicidade depende do serviço.
- Cada dispositivo e perfil do navegador precisa instalar a extensão. Nenhuma credencial é enviada ao servidor da ferramenta.
- A validação automatizada utiliza respostas simuladas. O teste real precisa ocorrer no navegador conectado ao RepoSprint.

Para desinstalar, remova a extensão na página de extensões. Para atualizar os arquivos, clique em **Recarregar** nessa mesma página e recarregue a ferramenta.

A versão 0.1.1 agrupa abas do mesmo workspace em uma única opção. O workspace já vem selecionado; a última escolha fica salva neste perfil do navegador. Se essa escolha não estiver aberta, seleciona uma opção disponível. Após atualizar os arquivos, clique em Recarregar na página de extensões e feche/reabra a janela da extensão.
