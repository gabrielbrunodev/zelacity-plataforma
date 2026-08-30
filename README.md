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
npm run bootstrap-admin -- admin@prefeitura.gov.br "UseUmaSenhaForteCom12Caracteres" "Nome do Administrador"
```

Depois, entre em [http://localhost:3000/login.html](http://localhost:3000/login.html). Não há senha padrão gravada no projeto.

## Fluxo de uso

### Cidadão

- Registra uma solicitação sem login, usando nome, telefone/WhatsApp, e-mail opcional, local, bairro, ponto de referência, serviço, descrição, foto e GPS opcionais.
- Recebe um protocolo `SOL-AAAA-00001` na tela.
- Pode compartilhar o protocolo manualmente por WhatsApp e, quando houver e-mail, pelo cliente de e-mail. O sistema também deixa notificações enfileiradas para uma integração futura; uma falha externa nunca impede o cadastro.
- Consulta sem login com protocolo e os últimos quatro dígitos do telefone. A consulta não retorna nome, telefone, e-mail, descrição, referência ou imagens.

### Vereador

- Recebe login criado pelo administrador; não há cadastro público para esse perfil.
- Pode registrar solicitações com localização GPS e foto. O servidor grava a origem como **Vereador**, vincula o protocolo à conta e registra essa ação no histórico.
- Ao entrar no painel, visualiza somente as solicitações que criou, com protocolo, serviço, local, prioridade e status.
- Não pode alterar status ou prioridade, criar OS, atribuir equipe, encerrar solicitações ou acessar usuários, relatórios e controles administrativos.

### Administração

- Acessa dashboard, mapa, relatórios, solicitações, ordens e histórico por login.
- Novas solicitações entram como **Aguardando análise**.
- Pode aprovar, indeferir, solicitar informações adicionais, ajustar prioridade, cadastrar equipes, funcionários internos e vereadores, distribuir demandas e criar OS.
- Só a administração conclui definitivamente a solicitação.

### Equipe de manutenção

- Usa [http://localhost:3000/manutencao.html](http://localhost:3000/manutencao.html), uma área otimizada para celular.
- Vê apenas OS da própria equipe, agrupadas em Pendentes, Em execução, Com pendência e Executadas.
- Pode iniciar, concluir com fotos/GPS/observação ou informar impedimento. A conclusão operacional deixa a OS como **Executada**, sem encerrar a solicitação.
- Não possui rotas para alterar prioridade, atribuição, dados do cidadão ou usuários.

## Segurança e dados

- Senhas usam `scrypt`; sessões são cookies `HttpOnly` com `SameSite=Strict`.
- A autorização é validada no backend, inclusive para rotas de arquivos e operações de OS.
- Imagens aceitam apenas JPG, PNG ou WebP, com no máximo 5 MB, e passam por validação de tipo e assinatura.
- A auditoria é imutável e registra criação, análise, prioridade, OS, atribuição, início, pendência, execução e conclusão.
- O SQLite fica em `data/munimanutencao.sqlite`; reiniciar o servidor não apaga os dados.

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

O service worker já está preparado para receber notificações push no futuro. O sistema ainda não pede nem envia notificações sem uma integração de assinatura e entrega configurada no servidor.

## Scripts

| Comando | Descrição |
| --- | --- |
| `npm start` | Inicia o servidor na porta 3000. |
| `npm run dev` | Inicia o servidor com monitoramento de arquivos. |
| `npm run check` | Verifica a sintaxe do servidor e das interfaces JavaScript. |
| `npm run bootstrap-admin -- e-mail senha nome` | Cria o primeiro administrador, se ainda não houver um ativo. |

`GET /api/health` retorna o estado básico da API.

