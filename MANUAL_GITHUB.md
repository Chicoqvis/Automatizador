# Manual: token do GitHub e nome do repositório

Este manual explica como conectar sua própria conta GitHub ao Automatizador. O token permite que a ferramenta crie issues no repositório autorizado, em seu nome.

## 1. Encontre o proprietário e o nome do repositório

1. Abra a página do repositório no GitHub.
2. Veja o endereço no navegador. Ele terá este formato:

   ```text
   https://github.com/PROPRIETARIO/REPOSITORIO
   ```

3. Na ferramenta, informe somente `PROPRIETARIO/REPOSITORIO`, sem `https://github.com/` e sem `.git`.

   Exemplo: para `https://github.com/Chicoqvis/Automatizador`, informe:

   ```text
   Chicoqvis/Automatizador
   ```

O proprietário é o nome da conta ou organização que aparece primeiro; o nome do repositório aparece depois da barra. Confirme que sua conta tem acesso ao repositório.

## 2. Crie um token de acesso fino

1. No GitHub, clique na sua foto de perfil e abra **Settings**.
2. No menu lateral, abra **Developer settings** → **Personal access tokens** → **Fine-grained tokens**.
3. Clique em **Generate new token**.
4. Dê um nome que ajude a lembrar para que serve, por exemplo `Automatizador de issues`.
5. Escolha uma validade. Tokens expiram; você poderá criar outro quando necessário.
6. Em **Resource owner**, selecione a conta ou organização proprietária do repositório.
7. Em **Repository access**, escolha **Only select repositories** e selecione somente o repositório que vai conectar.
8. Em **Repository permissions**, defina **Issues** como **Read and write**.
9. Se for adicionar issues a um GitHub Project ou alterar seu status pela ferramenta, defina também **Projects** como **Read and write**. Essa permissão é necessária apenas para usar os recursos de Projects.
10. Clique em **Generate token** e copie o token. O GitHub só o mostra integralmente na criação.

Para um token fine-grained, o GitHub permite limitar o acesso a repositórios específicos e escolher permissões por repositório. Uma organização pode exigir aprovação do token por um administrador antes que ele funcione. [Documentação oficial sobre tokens pessoais](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) · [Permissões exigidas pela API](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens)

## 3. Conecte o repositório na ferramenta

1. Entre na sua conta do Automatizador.
2. Na área de integração com GitHub, preencha o repositório no formato `PROPRIETARIO/REPOSITORIO`.
3. Cole o token no campo de token e clique para conectar.
4. Opcionalmente, marque **Lembrar o repositório neste navegador** para salvar o nome do repositório neste dispositivo. Na versão online, o token fica criptografado na sua conta para manter a conexão, e não é salvo no armazenamento do navegador.
5. Use a função de criar issue. A issue será aberta no repositório selecionado pela sua conta GitHub e ficará sujeita às permissões dela.

## Segurança

- Nunca envie seu token por mensagem, e-mail, captura de tela ou arquivo do repositório.
- Não use o token de outra pessoa. Cada usuário deve conectar o próprio token.
- Conceda acesso somente ao repositório necessário e apenas as permissões indicadas acima.
- Se o token for exposto, revogue-o nas configurações de tokens pessoais do GitHub e crie outro.
- Se o token expirar ou perder acesso, crie um novo e conecte novamente.
