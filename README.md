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
