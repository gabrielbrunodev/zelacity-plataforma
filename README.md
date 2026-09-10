# Zelacity Plataforma

Sistema municipal para registrar solicitações, analisar demandas e executar ordens de serviço. Roda localmente no Windows com Node.js e SQLite.

## Requisitos

- Node.js 22.5 ou posterior
- PowerShell no Windows

## Instalação e execução

1. Abra o PowerShell na pasta do projeto.
2. Execute `npm install`.
3. Inicie o sistema:

   ```powershell
   npm start
   ```

4. Acesse [http://localhost:3000](http://localhost:3000).

Para desenvolvimento, com reinício automático:

```powershell
npm run dev
```

Se o PowerShell bloquear scripts, execute uma vez para o seu usuário:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## Primeiro administrador

O cidadão não cria conta e não faz login. Para acessar a administração, crie o primeiro administrador uma única vez:

```powershell
npm run bootstrap-admin -- admin@prefeitura.gov.br "SenhaForteCom8Caracteres" "Nome do Administrador"
```

Depois, entre em [http://localhost:3000/login.html](http://localhost:3000/login.html). Não há senha padrão gravada no projeto.

## Fluxo de uso

### Cidadão

- Registra uma solicitação sem login, usando nome, telefone/WhatsApp, e-mail opcional, local, bairro, ponto de referência, serviço, descrição, foto e GPS opcionais.
- Recebe um protocolo no formato `AAAA-00001` na tela.
- Pode compartilhar o protocolo manualmente por WhatsApp e, quando houver e-mail, pelo cliente de e-mail. O sistema também deixa notificações enfileiradas para uma integração futura; uma falha externa nunca impede o cadastro.
- Consulta sem login apenas pelo protocolo do aplicativo. A consulta não retorna nome, telefone, e-mail, descrição, referência ou imagens.

### Vereador

- Recebe login criado pelo administrador; não há cadastro público para esse perfil.
- Pode registrar solicitações com localização GPS e foto. O servidor grava a origem como **Vereador**, vincula o protocolo à conta e registra essa ação no histórico.
- Ao entrar no painel, visualiza somente as solicitações que criou, com protocolo, serviço, local, prioridade e status.
- Não pode alterar status ou prioridade, criar OS, atribuir equipe, encerrar solicitações ou acessar usuários, relatórios e controles administrativos.

### Administração

- Acessa dashboard, mapa, relatórios, solicitações, ordens e histórico por login.
- Pode usar **Nova solicitação do 1Doc** para transferir manualmente uma demanda oficial: informa o protocolo do 1Doc, a data de recebimento, dados da demanda, prioridade, foto opcional e observações internas. O sistema gera um protocolo próprio e mantém os dois números vinculados, sem integração automática com a API do 1Doc.
- A pesquisa de solicitações administrativas aceita tanto o protocolo do aplicativo quanto o protocolo vinculado do 1Doc.
- Toda solicitação possui uma origem obrigatória: **Munícipe**, **Vereador**, **1Doc** ou **Administração**. Ela é definida pelo servidor conforme o fluxo de cadastro; o painel e os relatórios permitem filtrar e consolidar os dados por origem.
- As prioridades disponíveis são **Baixa**, **Normal**, **Alta** e **Urgente**; novas solicitações começam em **Normal** e podem ser ajustadas pelo administrador.
- O administrador pode definir um prazo padrão opcional, em dias, para cada categoria e alterar o prazo de uma solicitação específica. O painel mostra a data de abertura, os dias em aberto e alertas de prazo próximo ou atrasado. Esses prazos são operacionais e configuráveis; o sistema não aplica regra legal automática.
- Novas solicitações entram como **Aguardando análise**.
- Pode aprovar, indeferir, solicitar informações adicionais, ajustar prioridade, cadastrar equipes, funcionários internos e vereadores, distribuir demandas e criar OS.
- Pode revisar o histórico e editar posteriormente a mensagem pública da solicitação concluída.

### Equipe de manutenção

- Usa [http://localhost:3000/manutencao.html](http://localhost:3000/manutencao.html), uma área otimizada para celular.
- Vê apenas OS da própria equipe, agrupadas em Pendentes, Em execução, Com pendência e Executadas.
- Pode iniciar, concluir com fotos/GPS/observação e materiais utilizados, ou informar impedimento. A conclusão registra data e horário automaticamente e deixa a OS e a solicitação como **Concluídas**.
- Não possui rotas para alterar prioridade, atribuição, dados do cidadão ou usuários.
- Conta com uma central interna de notificações: o sino mostra a quantidade não lida e registra novas atribuições, redistribuições, alterações relevantes da OS e mensagens enviadas pela Administração. As notificações podem ser marcadas como lidas individualmente ou de uma só vez.

## Segurança e dados

- Senhas usam `scrypt` com sal aleatório; sessões armazenam apenas o hash do token e usam cookies `HttpOnly`, `SameSite=Strict` e `Secure` em produção.
- Páginas internas, APIs administrativas, imagens e operações de OS validam autenticação e perfil no backend. Funcionários só acessam demandas da equipe ou atribuídas diretamente a eles.
- A consulta pública retorna exclusivamente protocolo, categoria, bairro resumido, datas, status e mensagem pública; nunca dados de contato, observações internas, imagens ou responsáveis.
- Imagens aceitam apenas JPG, PNG ou WebP, com no máximo 5 MB, e passam por validação de tipo e assinatura.
- A auditoria é imutável e classifica criação, alteração de status, atribuição, redistribuição, prioridade, fotos, observações, protocolo 1Doc, início, impossibilidade, conclusão e reabertura. O histórico administrativo mostra todos os detalhes; a consulta pública exibe somente eventos com atualização pública.
- Em execução local, o SQLite fica em `data/munimanutencao.sqlite`; reiniciar o servidor não apaga os dados.
- Na Vercel, o ambiente de funções não possui disco permanente. Sem um banco externo configurado, o protótipo usa `/tmp`, que pode ser recriado quando a função é reiniciada. Antes de usar dados reais em produção, configure um banco persistente (por exemplo, Vercel Postgres/Neon, Supabase ou Turso) e migre o adaptador de persistência; não use o SQLite temporário da Vercel como banco oficial.

Por padrão, a foto posterior é recomendada, mas não obrigatória. Para exigi-la ao concluir um serviço, configure antes de iniciar o servidor:

```powershell
$env:REQUIRE_AFTER_EXECUTION_PHOTO = "true"
```

## Google Maps e GPS

O endereço manual sempre funciona. Para habilitar seleção no mapa e preenchimento automático de rua/bairro, configure a chave da Maps JavaScript API na mesma janela do PowerShell que inicia o servidor:

```powershell
$env:GOOGLE_MAPS_API_KEY = "SUA_CHAVE_DO_GOOGLE_MAPS"
npm start
```

Restrinja a chave para `http://localhost:3000` e habilite somente a Maps JavaScript API necessária. A chave é usada apenas para carregar o mapa no navegador.

## PWA e uso no celular

O Zelacity pode ser instalado como aplicativo. O manifesto, o ícone e o service worker ficam em `public/`; o cache armazena apenas as telas e arquivos estáticos. Consultas, cadastros, fotos, login e atualizações continuam indo para a API e precisam de conexão — nenhuma solicitação é enviada silenciosamente enquanto o aparelho estiver offline.

Para testar no computador, inicie com `npm start`, abra [http://localhost:3000](http://localhost:3000) e use o botão **Instalar aplicativo** (quando o navegador o disponibilizar) ou o menu de instalação do navegador. `localhost` é aceito como origem segura para desenvolvimento.

Para testar no celular:

1. Deixe o computador e o celular na mesma rede e inicie o servidor.
2. Disponibilize a aplicação em uma URL **HTTPS** acessível pelo celular (por exemplo, em um ambiente de homologação com certificado). Em celulares, um endereço IP local em HTTP não habilita service worker, câmera e GPS de forma confiável.
3. Abra essa URL no navegador do celular. No Android/Chrome, escolha **Instalar aplicativo** ou **Adicionar à tela inicial**. No iPhone/Safari, toque em **Compartilhar** e em **Adicionar à Tela de Início**.
4. Abra o ícone instalado: ele iniciará em modo standalone. Cadastre uma solicitação, teste a câmera pelo campo de foto e permita a localização somente quando desejar compartilhá-la.

O service worker e o banco já possuem a base para notificações push futuras: as assinaturas de dispositivos poderão ser vinculadas aos funcionários e cada notificação interna fica marcada como pendente dessa configuração. Esta versão ainda não pede permissão nem envia push, pois isso depende de configurar chaves, serviço de entrega e a integração do APK/PWA.

## APK Android com GitHub Actions

O projeto está preparado para ser empacotado com Capacitor, sem remover ou alterar o funcionamento da versão web. O APK contém as telas HTML, CSS e JavaScript e usa a mesma API hospedada para login, solicitações, fotos e atualizações; o servidor Node.js e o SQLite **não** são copiados para o celular.

A configuração usa somente as permissões necessárias para os recursos já existentes:

- câmera, para anexar fotos;
- localização aproximada e precisa, somente quando a pessoa usar o botão de localização;
- Internet, para comunicar-se com a API hospedada.

Não há permissão de localização em segundo plano, armazenamento amplo, contatos, telefone, microfone ou leitura de arquivos pessoais. Os links de localização são convertidos em `geo:` no Android para abrir o aplicativo de mapas disponível no aparelho. A pasta `resources/` contém a fonte vetorial do ícone e da tela de abertura; os tamanhos Android são gerados automaticamente durante a compilação.

### Antes do primeiro APK

1. Mantenha a aplicação web publicada em uma URL HTTPS, como a implantação da Vercel.
2. No painel da hospedagem, configure a variável de ambiente **não secreta** `MOBILE_ALLOWED_ORIGINS` com `https://localhost`. Isso libera exclusivamente o WebView do Capacitor para acessar a API, com CORS e cookie de sessão apropriados. Não use `*` e não inclua origens desconhecidas.
3. Antes de publicar em uma loja, defina o identificador definitivo do aplicativo. O valor atual, `br.dev.zelacity.plataforma`, é apenas para compilação de teste; mudá-lo após distribuir o aplicativo impede atualizações sobre a instalação anterior.

### Gerar pelo GitHub

No repositório, abra **Actions** → **Gerar APK Android** → **Run workflow**. Informe a origem HTTPS da aplicação, por exemplo `https://zelacity-plataforma.vercel.app`. Ao fim, baixe o arquivo `zelacity-android-debug-apk` na seção de artefatos da execução.

O fluxo instala as dependências, gera o projeto Android, os ícones e a abertura, sincroniza o Capacitor e produz um APK de teste. Ele não assina nem publica o aplicativo.

### APK de produção assinado

O fluxo **Gerar APK Android assinado** cria uma versão de produção manual, com `versionCode`, `versionName` e a mesma assinatura em todas as atualizações. Ele só usa informações temporárias durante a execução; nenhuma chave, senha ou arquivo de assinatura é salvo no repositório ou enviado como artefato.

Antes de executá-lo, abra **Settings** → **Secrets and variables** → **Actions** → **New repository secret** e cadastre estes quatro segredos:

| Secret | Conteúdo |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Arquivo `.jks` ou `.keystore` codificado em Base64, em uma única linha. |
| `ANDROID_KEYSTORE_ALIAS` | Alias da chave criada no keystore. |
| `ANDROID_KEYSTORE_PASSWORD` | Senha do keystore. |
| `ANDROID_KEY_PASSWORD` | Senha da chave/alias. |

No Windows, para copiar o conteúdo Base64 do arquivo para a área de transferência sem colocá-lo no projeto, execute em uma máquina confiável:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\caminho\zelacity-release.jks')) | Set-Clipboard
```

Cole esse conteúdo no secret `ANDROID_KEYSTORE_BASE64`. Nunca cole um keystore ou senha diretamente em arquivo YAML, código, issue, commit ou chat público.

Depois, abra **Actions** → **Gerar APK Android assinado** → **Run workflow**. Informe a URL HTTPS, um `versionCode` maior que o da última versão distribuída e um `versionName` para exibição, por exemplo `1.0.0`. O artefato será `zelacity-android-release-v<versionName>` e conterá o `app-release.apk` assinado.

Guarde permanentemente, em local seguro e fora do GitHub: o arquivo original `.jks`/`.keystore`, o alias, as duas senhas e uma cópia de recuperação dessas informações. O `appId` atual é `br.dev.zelacity.plataforma`; ele e a assinatura não podem mudar em atualizações do mesmo aplicativo. A perda do keystore, alias ou senhas impede instalar futuras versões sobre as instalações já distribuídas, exigindo publicar um aplicativo novo.

## Scripts

| Comando | Descrição |
| --- | --- |
| `npm start` | Inicia o servidor na porta 3000. |
| `npm run dev` | Inicia o servidor com monitoramento de arquivos. |
| `npm run check` | Verifica a sintaxe do servidor e das interfaces JavaScript. |
| `npm run bootstrap-admin -- e-mail senha nome` | Cria o primeiro administrador, se ainda não houver um ativo. |

`GET /api/health` retorna o estado básico da API.

