const express = require("express");
const router = express.Router();
const axios = require("axios");
const { searchProducts } = require("../services/productSearch");

/*
Memória por usuário
*/
const conversations = {};
const userLastProduct = {};

/*
Cache simples
*/
const responseCache = {};

/*
Sinônimos de produtos (expandido)
*/
const productSynonyms = {
  camiseta: ["camiseta", "camisa", "tshirt", "t-shirt", "tee"],
  regata: ["regata", "tank", "tanktop", "camisa regata", "camiseta regata"],
  calca: ["calça", "calca", "pants", "trouser"],
  bermuda: ["bermuda", "short", "shorts"],
  tenis: ["tenis", "tênis", "sneaker", "shoe"],
  cinto: ["cinto", "belt", "leather belt", "couro"],
};

// Conjunto plano de todos os sinônimos para busca rápida
const allSynonyms = new Set();
Object.values(productSynonyms).forEach(list => list.forEach(syn => allSynonyms.add(syn)));

/*
Verifica se a consulta contém algum sinônimo de produto
*/
function containsProductSynonym(query) {
  const q = query.toLowerCase();
  for (let syn of allSynonyms) {
    if (q.includes(syn)) return true;
  }
  return false;
}

/*
Formatar texto antes de enviar ao Telegram
*/
function formatTelegram(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
    .replace(/\n/g, "<br>");
}

/*
Normalizar consulta do usuário com melhoria no follow-up
*/
function normalizeQuery(query, userId) {

  const q = query.toLowerCase();

  // Primeiro, tenta mapear para a chave canônica se houver sinônimo
  for (const key in productSynonyms) {

    for (const synonym of productSynonyms[key]) {

      if (q.includes(synonym)) {
        // Atualiza último produto consultado
        userLastProduct[userId] = key;
        // Substitui o sinônimo pela chave canônica na query original (mantém capitalização)
        return query.replace(new RegExp(synonym, "gi"), key);

      }

    }

  }

  /*
  Follow-up contextual: só prepende se a consulta NÃO contiver nenhum sinônimo de produto
  Ex: "tem azul?" → não tem sinônimo → prepende último produto
  Ex: "e cinto de couro?" → contém "cinto" → não prepende
  */
  if (userLastProduct[userId] && !containsProductSynonym(q)) {
    return userLastProduct[userId] + " " + query;
  }

  return query;
}

/*
Trunca mensagens longas do assistente para não estourar tokens
*/
function truncateHistory(history, maxTurns = 6, maxAssistantLength = 200) {
  const limited = history.slice(-maxTurns);
  return limited.map(msg => {
    if (msg.role === 'assistant' && msg.content.length > maxAssistantLength) {
      return { ...msg, content: msg.content.substring(0, maxAssistantLength) + '...' };
    }
    return msg;
  });
}

/*
Fallback
*/
function fallbackResponse() {
  return `
  Não tenho certeza sobre isso, mas posso ajudar com:

  • informações sobre produtos
  • suporte técnico
  • falar com atendente

  Como posso ajudar?
  `;
}

/*
Logs estruturados
*/
function logConversation(userId, question, answer) {

  console.log(JSON.stringify({
    user: userId,
    question,
    answer,
    timestamp: new Date().toISOString()
  }, null, 2));

}

/*
Limitar contexto inteligente (já existente)
*/
function limitContext(history) {

  const MAX_TURNS = 8;

  if (history.length > MAX_TURNS) {
    return history.slice(-MAX_TURNS);
  }

  return history;

}

/*
Detecção de intenção usando LLM
*/
async function detectIntentLLM(message, history = []) {

  try {

    const contextMessages = history.slice(-4);

    const response = await axios.post(
      "https://models.inference.ai.azure.com/chat/completions",
      {
        model: process.env.MODEL,
        messages: [
          {
            role: "system",
            content: `
            Você é um classificador de intenção para um chatbot de uma loja de roupas.

            Classifique a mensagem do usuário em UMA das intenções abaixo:

            greeting → cumprimentos (ex: oi, olá, bom dia, qual sua função?)
            product → perguntas sobre produtos (ex: tem camiseta preta? preço da calça? o que é oversized?)
            human → usuário quer falar com atendente humano

            Responda APENAS com uma palavra:

            greeting
            product
            human
            help
            question
            `
          },

          ...contextMessages,

          {
            role: "user",
            content: message
          }
        ],
        temperature: 0
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    return response.data.choices[0].message.content.trim();

  } catch {

    return "question";

  }

}

/*
Simular streaming (mantido)
*/
async function simulateStreaming(text, res) {

  const words = text.split(" ");
  let partial = "";

  for (let i = 0; i < words.length; i++) {
    partial += words[i] + " ";
  }

  return partial;

}

router.post("/", async (req, res) => {

  console.log("BODY:", req.body);

  try {

    const userId = req.body.from || "anonymous";
    let userMessage = "";

    if (typeof req.body.content === "string") {
      userMessage = req.body.content;
    } else if (req.body.content && typeof req.body.content === "object") {
      if ("text" in req.body.content) userMessage = req.body.content.text;
      else if ("content" in req.body.content) userMessage = req.body.content.content;

    }

    if (!userMessage) {
      return res.status(400).json({ reply: "Mensagem inválida" });
    }

    // Criar/atualizar memória
    if (!conversations[userId]) {
      conversations[userId] = [];
    }

    conversations[userId].push({
      role: "user",
      content: userMessage
    });

    // Detectar intenção
    const intent = await detectIntentLLM(userMessage, conversations[userId]);
    console.log("Intent detectada:", intent);

    let reply = null;

    // Fluxos do bot
    if (intent === "greeting") {
      reply = "Olá! 👋 Bem-vindo à UrbanStyle! 👟👕 Sou o assistente virtual da loja e estou aqui para ajudar você. Você pode perguntar sobre produtos, tamanhos, preços ou disponibilidade.";
    }

    else if (intent === "help") {
      reply = "Posso ajudar você a encontrar produtos, verificar preços e tamanhos ou tirar dúvidas sobre a loja. 👕👟";
    }

    else if (intent === "human") {
      reply = "Claro! Vou encaminhar você para um atendente.";
    }

    else if (intent === "product" || intent === "question") {
      // Normaliza a consulta com a nova lógica
      const normalizedQuery = normalizeQuery(userMessage, userId);

      // Busca produtos
      const lastCategory = userLastProduct[userId];
      const results = await searchProducts(normalizedQuery, lastCategory);

      if (results.length === 0) {
        return res.json({
          reply: "Não encontrei esse produto no catálogo."
        });
      }

      // Prepara contexto dos produtos
      const productContext = results.map(p => {
        return `Produto: ${p.name}\nPreço: R$${p.price}\nDescrição: ${p.description}`;
      }).join("\n\n");

      // Obtém histórico recente (inclui a mensagem atual do usuário) e trunca respostas longas
      const recentHistory = truncateHistory(conversations[userId], 6, 200);

      // Monta mensagens para o LLM com contexto completo
      const messages = [
        {
          role: "system",
          content: `
            Você é um assistente de vendas de uma loja.
            IMPORTANTE:
            - Use SOMENTE os produtos fornecidos.
            - NÃO invente produtos.
            - Se o produto não estiver na lista, diga que não encontrou.
            - Responda de uma maneira um pouco descontraída.
          `
        },
        {
          role: "system",
          content: `Produtos disponíveis:\n${productContext}`
        },
        ...recentHistory  // Inclui as últimas trocas (usuário e assistente)
      ];

      const response = await axios.post(
        "https://models.inference.ai.azure.com/chat/completions",
        {
          model: process.env.MODEL,
          messages,
          temperature: 0.4
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
            "Content-Type": "application/json"
          }
        }
      );

      reply = response.data.choices[0].message.content;

      conversations[userId].push({
        role: "assistant",
        content: reply
      });

      logConversation(userId, userMessage, reply);

      reply = formatTelegram(reply);
      return res.json({ reply });

    }

    // Se algum fluxo respondeu
    if (reply) {

      conversations[userId].push({
        role: "assistant",
        content: reply
      });

      logConversation(userId, userMessage, reply);

      reply = formatTelegram(reply);
      return res.json({ reply });

    }

    // Cache
    const cacheKey = userMessage.toLowerCase();

    if (responseCache[cacheKey]) {

      reply = responseCache[cacheKey];

      reply = formatTelegram(reply);
      return res.json({ reply });

    }

    // Contexto inteligente (fallback geral)
    const context = limitContext(conversations[userId]);

    const response = await axios.post(
      "https://models.inference.ai.azure.com/chat/completions",
      {
        model: process.env.MODEL,
        messages: [
          {
            role: "system",
            content: "Você é um assistente educado dentro de um chatbot. Responda sempre em texto simples."
          },
          ...context
        ],
        temperature: 0.7
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    reply = response.data.choices[0].message.content || fallbackResponse();

    conversations[userId].push({
      role: "assistant",
      content: reply
    });

    responseCache[cacheKey] = reply;

    logConversation(userId, userMessage, reply);

    const finalReply = await simulateStreaming(reply, res);
    res.json({ reply: finalReply });

  } catch (error) {

    console.error("Erro:", error.response?.data || error.message);
    res.json({ reply: fallbackResponse() });
  }

});

module.exports = router;