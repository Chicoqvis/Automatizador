# Integração RepoSprint sem extensão — diagnóstico

Verificação em 11/10/2026.

## Resultado

Não há, até este diagnóstico, um método confirmado de autenticação delegada para conectar cada conta da ferramenta ao RepoSprint pelo servidor. A integração atual deve continuar usando a extensão.

## Evidências verificadas

- O site oficial divulga login via GitHub: https://reposprint.com/.
- O cliente público em https://reposprint.com/app/assets/index-BHnM0c4i.js usa autenticação por sessão, com login social GitHub. Não foi encontrada configuração pública de emissão de tokens de API ou de aplicativos OAuth externos. Isso não prova que o fornecedor não ofereça uma integração privada.
- Consulta sem credenciais a process.lifecycle.phaseSummaries: HTTP 401 para ambos os domínios testados. Com Origin https://reposprint.com, a resposta inclui Access-Control-Allow-Origin para esse domínio. Com Origin https://automacao-issues-ai.automacao-issue-chico.workers.dev, não inclui Access-Control-Allow-Origin. Portanto, a chamada direta do navegador do nosso site não é permitida pela configuração observada.
- Fazer a requisição pelo servidor elimina a restrição CORS, mas não fornece autenticação. O token GitHub conectado à ferramenta não foi confirmado como credencial válida na API RepoSprint.

## Informação necessária do fornecedor

Solicitar documentação de API e autenticação para aplicações externas: token por usuário, OAuth delegado ou conta de serviço com permissões claramente definidas. Confirmar escopos, expiração, revogação, limites de requisições e registro do usuário que executa cada ação. Para preservar a identidade das aprovações e devoluções, preferir autorização individual por usuário.

Mensagem sugerida:

> Estamos integrando uma ferramenta ao RepoSprint para consultar issues e fases, gerenciar backlog e executar devoluções/aprovações usando as permissões de cada usuário. Existe API com token individual ou OAuth para aplicações externas? Precisamos da documentação de autenticação, escopos, limites e endpoints suportados.

## Implementação após confirmar autenticação

1. Conectar a conta RepoSprint individualmente na ferramenta.
2. Guardar credenciais criptografadas por conta no servidor, sem retornar segredos ao navegador.
3. Executar os endpoints permitidos pelo servidor com validação de acesso e limites.
4. Migrar a consulta de fases e aprovações; depois migrar ações de escrita com confirmação e sem repetição automática.
5. Validar com duas contas diferentes antes de dispensar a extensão.

Não foi implementada importação de cookies, compartilhamento da sessão de um administrador ou um login por proxy. Nenhuma credencial RepoSprint foi coletada nestes testes.
