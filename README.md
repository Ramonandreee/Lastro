# Lastro · Inteligência de Investimentos

Plataforma de análise de investimentos para o mercado brasileiro — FIIs, ações B3, indicadores fundamentalistas e o **Score Lastro™** proprietário, com Inteligência Artificial integrada.

> Posicionamento: concorrente direto do Investidor10, com foco em **decisão**, não apenas em dados. Design premium, Score proprietário, simulador de renda passiva e diagnóstico de carteira por IA.

---

## 1. O que diferencia o Lastro

A plataforma cobre **renda variável de ponta a ponta** em 15 telas:

**Mercado:** Painel · Ações · FIIs · BDRs · ETFs · Stocks (EUA) · Criptomoedas
**Ferramentas:** Minha Carteira · Comparador · Rastreador (Screener) · Agenda de Dividendos · Carteiras Recomendadas · Notícias
**Inteligência:** Simulador de Renda · Score Lastro™

| Recurso | Lastro | Investidor10 |
|---|---|---|
| Score de qualidade proprietário (0–100) | ✅ Score Lastro™ transparente | ❌ |
| Comparador lado a lado com destaque do melhor | ✅ | ⚠️ |
| Rastreador com filtros interativos (sliders) | ✅ | ✅ |
| Simulador de renda passiva (bola de neve) | ✅ Interativo | ⚠️ Limitado |
| Agenda de dividendos personalizada | ✅ Calcula por cotas | ✅ |
| Carteiras recomendadas por perfil | ✅ | ✅ (pago) |
| Notícias em tempo real com tags | ✅ | ✅ |
| Diagnóstico de carteira por IA | ✅ Nativo em todas as telas | ❌ |
| Dark mode premium | ✅ | ❌ |
| Busca global (⌘K) | ✅ | ⚠️ |
| Identidade visual própria | ✅ | Genérica |

### Score Lastro™ — fórmula transparente
```
Score = DY sustentável (35%) + Valuation P/VP (30%) + Liquidez (20%) + Consistência (15%)
```
Diferente de "selos" opacos, o Score é auditável: cada pilar é exibido com sua contribuição.

---

## 2. Estrutura do projeto (web)

```
lastro/
├── index.html        ← Aplicação completa (HTML + CSS + JS, single-file)
├── config.js         ← Chaves de API (NÃO versionar)
├── .gitignore
└── README.md
```

O `index.html` é **autossuficiente** — abre em qualquer navegador. Charts via Chart.js (CDN), ícones via Font Awesome (CDN), fontes via Google Fonts. Funciona offline com dados estáticos; com conexão, busca dados ao vivo e ativa a IA.

---

## 3. Deploy no GoDaddy

### Via cPanel (mais simples)
1. Painel GoDaddy → **cPanel** → **Gerenciador de Arquivos**
2. Entre em `public_html/`
3. Suba `index.html` (renomeie para `index.html` se quiser que seja a home)
4. Acesse seu domínio — está no ar

### Apontar o domínio
- Em **DNS Management**, garanta que o registro `A` aponta para o IP do seu hosting
- Para HTTPS, ative o **SSL gratuito** (AutoSSL) no cPanel

### Performance (recomendado)
- Ative **compressão Gzip** e **cache** no `.htaccess`:
```apache
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css application/javascript
</IfModule>
<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType text/css "access plus 1 month"
  ExpiresByType application/javascript "access plus 1 month"
</IfModule>
```

---

## 3.5. Deploy na Vercel (recomendado) ⭐

A forma mais simples de subir **front + proxy de IA + config seguro** de uma vez,
no plano gratuito. Já existe `vercel.json` configurado no repositório.

**Como funciona:**
- O front (`index.html`) é servido como estático.
- `api/ai.js` é o proxy serverless da Anthropic (a chave fica só no servidor).
- `api/config.js` gera o `config.js` a partir das variáveis de ambiente — assim
  **nenhuma chave é versionada** e o front recebe a config real em produção
  (o `vercel.json` faz o rewrite de `/config.js` → `/api/config`).
- As funções rodam na região **São Paulo (`gru1`)** — menor latência para o BR.

**Passos:**
1. Acesse [vercel.com](https://vercel.com) → **Add New → Project** → importe o repositório `Lastro`.
2. Em **Settings → Environment Variables**, defina:

   | Variável | Valor | Exposta ao navegador? |
   |---|---|---|
   | `ANTHROPIC_API_KEY` | `sk-ant-...` | **Não** (só o proxy `/api/ai` usa) |
   | `SUPABASE_URL` | `https://xxxx.supabase.co` | Sim (público) |
   | `SUPABASE_ANON_KEY` | `sb_publishable_...` | Sim (público, RLS protege) |
   | `BRAPI_TOKEN` | token da brapi.dev | Sim (já é client-side) |
   | `REFRESH_MS` / `NEWS_REFRESH_MS` | *(opcional)* | Sim |

3. **Deploy**. Pronto: `https://seu-projeto.vercel.app` no ar, com IA e dados ao vivo.
4. Domínio próprio: **Settings → Domains** → adicione seu domínio e ajuste o DNS.

> **CVM via `gru1`:** como as funções rodam em São Paulo, dá para mover a coleta dos
> Fatos Relevantes da CVM (hoje geobloqueada no GitHub Actions) para um **Vercel Cron**
> que roda um endpoint na `gru1`. Ver `backend/README-backend.md`.

---

## 4. Segurança da API — OBRIGATÓRIO em produção

⚠️ **Nunca** exponha a chave da Anthropic no HTML público. Crie um **proxy serverless**.

### Proxy na Vercel (grátis)
`api/ai.js`:
```js
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(req.body)
  });
  res.status(200).json(await r.json());
}
```
No `index.html`, troque a URL de `https://api.anthropic.com/v1/messages` para `/api/ai` (sem header de chave). O navegador nunca vê a chave.

---

## 5. Dados ao vivo

| Fonte | Uso | Custo |
|---|---|---|
| [brapi.dev](https://brapi.dev) | Cotações B3, FIIs, índices | Grátis (15 req/min) |
| [Anthropic](https://console.anthropic.com) | Inteligência Lastro | Por uso |
| CoinGecko | Cripto | Grátis |

Para integração B3 oficial (carteira sincronizada), avaliar **Pluggy**, **Belvo** ou **B3/CERC** via parceria.

### Cotações ao vivo (já implementado)

O `index.html` busca cotações reais da **brapi.dev** e atualiza preço (`px`) e
variação (`var`) das telas de Ações, FIIs, BDRs e ETFs, além das criptomoedas.
Funciona assim:

1. Pegue um token gratuito em [brapi.dev](https://brapi.dev) e coloque em
   `config.js → BRAPI_TOKEN`. **Sem token**, o app segue em modo *Demonstração*
   usando os dados estáticos (fallback silencioso).
2. O indicador no topo (`Ao vivo · HH:MM` / `Demonstração` / `Offline · em cache`)
   mostra a fonte atual; clicar nele força uma atualização.
3. O polling roda a cada `REFRESH_MS` (config.js, mín. 30s), pausando quando a
   aba fica em segundo plano para economizar requisições. As cotações são
   buscadas em lotes de 10 tickers para respeitar o limite do plano gratuito.

> Fundamentos (P/VP, ROE, DY, vacância) seguem estáticos por enquanto — exigem
> fonte de dados dedicada. A integração ao vivo cobre **preço e variação**.

---

## 6. App mobile — React Native (iOS + Android)

Repositório separado, compartilhando a lógica de negócio (Score Lastro, simulador) com a web via pacote comum.

```
lastro-app/
├── src/
│   ├── screens/        Painel · FIIs · Acoes · Carteira · Simulador · Score
│   ├── components/     ScoreGauge · MetricCard · AssetRow · AIInsight · SnowballChart
│   ├── lib/
│   │   ├── score.ts    ← scoreLastro() — MESMA fórmula da web (pacote compartilhado)
│   │   ├── api.ts      ← brapi + proxy IA
│   │   └── theme.ts    ← tokens de design (espelham as CSS vars do index.html)
│   ├── store/          Zustand (carteira, preferências)
│   └── navigation/
├── app.json
└── eas.json
```

### Stack
- **Expo** (managed) — build e submit simplificados para as lojas
- **React Navigation** — bottom tabs + stack
- **Victory Native** ou **react-native-gifted-charts** — gráficos
- **Zustand** + **MMKV** — estado e persistência local
- **Expo Notifications** — alertas de dividendos e preço

### Criar e publicar
```bash
npx create-expo-app lastro-app -t expo-template-blank-typescript
cd lastro-app
npx expo install expo-notifications expo-secure-store
npm i zustand react-native-mmkv @react-navigation/native @react-navigation/bottom-tabs

# Build nas lojas (requer conta Apple Developer US$99/ano e Google Play US$25 único)
npm i -g eas-cli
eas build --platform ios && eas submit --platform ios
eas build --platform android && eas submit --platform android
```

---

## 7. Arquitetura para escala (comercialização)

Quando virar produto pago, a evolução natural:

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Web (SPA)  │     │  App (RN)    │     │  Landing/Vendas │
└──────┬──────┘     └──────┬───────┘     └────────┬────────┘
       └───────────────────┼───────────────────────┘
                           │  API REST/GraphQL
                  ┌────────▼─────────┐
                  │  Backend (Node)  │  Auth · Carteiras · Score · Billing
                  └────────┬─────────┘
          ┌────────────────┼─────────────────┐
     ┌────▼────┐      ┌─────▼─────┐     ┌─────▼──────┐
     │ Postgres│      │ Redis cache│     │ Proxy IA   │
     │ (Supabase)     │ (cotações) │     │ (Anthropic)│
     └─────────┘      └───────────┘     └────────────┘
```

### Decisões recomendadas
- **Auth + DB**: Supabase (Postgres + Auth + Realtime, generoso no free tier)
- **Pagamentos BR**: Stripe ou Pagar.me / Asaas (PIX, boleto, recorrência)
- **Planos**: Free (dados básicos) · Pro (Score, simulador, IA, carteira ilimitada)
- **Cache de cotações**: Redis com TTL de 60s para reduzir custo de API
- **Migração da web**: o `index.html` atual vira a base de um app Vite + React, reaproveitando todo o design system (já está em CSS variables) e a lógica (já modularizável)

---

## 8. Roadmap

**MVP (atual)** ✅
- [x] Painel, FIIs, Ações, Carteira, Simulador, Score Lastro
- [x] Design premium + dark mode
- [x] Busca global, microinterações, animações
- [x] Hooks de IA e dados ao vivo

**Próximo**
- [ ] Proxy serverless de IA (segurança)
- [ ] Autenticação + carteira em nuvem (Supabase)
- [ ] Integração B3 (carteira automática)
- [ ] Alertas push (dividendos, preço, Score)
- [ ] App React Native nas lojas
- [ ] Billing e planos (Free/Pro)
- [ ] Landing page de vendas

---

## Identidade

- **Nome**: Lastro — o lastro é a reserva que dá respaldo a uma moeda. Inteligência como lastro das decisões.
- **Cores**: Esmeralda `#0E7C5A` (ganho/marca) · Clay `#D14343` (perda) · Ouro `#A87C2A` (elite do Score) · Azul `#2563EB` (interativo)
- **Tipografia**: Fraunces (display) · Inter (UI) · IBM Plex Mono (dados)
