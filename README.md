# OLX Garimpo 🔎

Extensão de Chrome que vigia buscas da OLX e **avisa quando aparece um anúncio novo ou quando um preço baixa**, sem você precisar ficar atualizando a página de meia em meia hora.

Ela faz sozinha a rotina de quem garimpa:

1. abre a busca ordenada por **mais recentes** → pega anúncios novos;
2. abre a busca ordenada por **menor preço** → pega anúncios antigos que **baixaram de preço** (esses não sobem para "recentes", porque o anúncio continua o mesmo).

## O que ela faz

- 🆕 **Anúncio novo** dentro da sua faixa de preço → notificação.
- 📉 **Queda de preço** num anúncio que ela já conhecia → notificação com "de R$ X para R$ Y".
- ↘️ **Anúncio que estava acima da faixa e baixou** → aparece como novo, com o preço antigo riscado.
- Filtros de título: palavras obrigatórias (ex.: `m4`) e palavras proibidas (ex.: `compro, troco por, defeito, peças`).
- Várias buscas ao mesmo tempo, cada uma com a sua faixa de preço.
- Histórico de alertas (últimos 300), com contador de não vistos no ícone.
- Aba **Na faixa agora**: tudo o que está na faixa, do mais barato ao mais caro.
- Aviso opcional no **celular** via [ntfy](https://ntfy.sh) (grátis, sem cadastro).

## Instalação

1. Baixe este repositório (**Code → Download ZIP**) e descompacte numa pasta fixa.
2. Abra `chrome://extensions`.
3. Ligue o **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** e escolha a pasta.
5. Fixe o ícone na barra (ícone de quebra-cabeça → alfinete).

Funciona também no Edge e no Brave.

## Como usar

1. Monte a busca na OLX do jeito que quiser (termo, categoria, região, filtro de entrega…).
2. Abra a extensão → aba **Buscas** → **usar a busca da aba aberta**.
3. Defina preço mínimo/máximo e as palavras do título → **Salvar busca**.

Um link só basta: a extensão aplica as duas ordenações (recentes e menor preço) sozinha e ignora a ordenação e a faixa de preço que estiverem no link. Os outros filtros do link (região, categoria, entrega) são mantidos.

Na **primeira verificação** ela só memoriza o que já existe; os alertas começam a partir da segunda.

### Aviso no celular (opcional)

1. Instale o app **ntfy** (Android/iPhone).
2. Toque em **+** e assine um tópico com nome difícil de adivinhar (ex.: `garimpo-joao-8f3k2`).
3. Na extensão, aba **Ajustes**, coloque o mesmo tópico e clique em **Enviar teste**.

> Qualquer pessoa que souber o nome do tópico consegue ler os avisos, então não use um nome óbvio.

## Como funciona por dentro

- A cada N minutos (padrão: 5) o service worker baixa a página de busca da OLX em segundo plano, **sem abrir abas**.
- Os anúncios vêm embutidos na página (dados do Next.js, `self.__next_f`); a extensão recorta o array `ads` e lê id, título, preço, preço antigo, data, cidade e link.
- A faixa de preço vai na própria URL (`ps` / `pe`), então só os anúncios relevantes são baixados.
- Cada anúncio fica guardado com o histórico de preço em `chrome.storage.local`.
- **Plano B:** se o download direto for bloqueado, a extensão abre a busca numa aba em segundo plano, lê os dados e fecha a aba.

Parâmetros da URL da OLX usados:

| Parâmetro | Significado |
|---|---|
| `q` | termo buscado |
| `sf=1` | ordenar por mais recentes |
| `sp=1` | ordenar por menor preço |
| `ps` / `pe` | preço mínimo / máximo |
| `o` | página |
| `opst=2` | só anúncios com Entrega |

## Limitações

- O Chrome precisa estar aberto (pode ficar minimizado). Com o computador em suspensão, a vigia pausa; quando volta, ela pega o que mudou nesse meio-tempo.
- Se a OLX mudar o formato da página, a leitura pode quebrar. Nesse caso aparece um aviso vermelho no topo da extensão.
- Consumo: cerca de 200–300 KB por verificação. Em internet móvel, aumente o intervalo em **Ajustes**.

## Estrutura

```
manifest.json    Manifest V3
background.js    agendamento, leitura da OLX, comparação de preços, notificações
popup.html/css/js  interface (Alertas, Na faixa agora, Buscas, Ajustes)
icons/           ícones
```

## Aviso

Projeto pessoal, sem relação com a OLX. Use com intervalos razoáveis para não sobrecarregar o site.

## Licença

MIT
