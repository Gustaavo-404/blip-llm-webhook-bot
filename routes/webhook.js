const express = require("express");
const router = express.Router();
const axios = require("axios");

/*
Memória por usuário
*/
const conversations = {};

/*
Cache simples
*/
const responseCache = {};

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
Limitar contexto inteligente
Mantém apenas últimos 4 turnos
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
async function detectIntentLLM(message) {

  try {

    const response = await axios.post(
      "https://models.inference.ai.azure.com/chat/completions",
      {
        model: process.env.MODEL,
        messages: [
          {
            role: "system",
            content: `
Classifique a intenção da mensagem do usuário.
Responda apenas com uma palavra.

Opções:
greeting
help
human
product
question
`
          },
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
Simular streaming
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
    const userMessage = req.body.content;

    if (!userMessage) {
      return res.status(400).json({
        reply: "Mensagem inválida"
      });
    }

    /*
    Criar memória
    */

    if (!conversations[userId]) {
      conversations[userId] = [];
    }

    /*
    Salvar mensagem
    */

    conversations[userId].push({
      role: "user",
      content: userMessage
    });

    /*
    Detectar intenção
    */

    const intent = await detectIntentLLM(userMessage);

    console.log("Intent detectada:", intent);

    let reply = null;

    /*
    Fluxos do bot
    */

    if (intent === "greeting") {

      reply = "Olá! Sou um assistente virtual. Como posso ajudar?";

    }

    else if (intent === "help") {

      reply = "Posso responder perguntas ou conectar você com um atendente.";

    }

    else if (intent === "human") {

      reply = "Claro! Vou encaminhar você para um atendente.";

    }

    else if (intent === "product") {

      reply = "Temos vários produtos disponíveis. O que você gostaria de saber?";

    }

    /*
    Se fluxo respondeu
    */

    if (reply) {

      conversations[userId].push({
        role: "assistant",
        content: reply
      });

      logConversation(userId, userMessage, reply);

      return res.json({
        reply
      });

    }

    /*
    Cache
    */

    const cacheKey = userMessage.toLowerCase();

    if (responseCache[cacheKey]) {

      reply = responseCache[cacheKey];

      return res.json({
        reply
      });

    }

    /*
    Contexto inteligente
    */

    const context = limitContext(conversations[userId]);

    /*
    Chamada da LLM
    */

    const response = await axios.post(
      "https://models.inference.ai.azure.com/chat/completions",
      {
        model: process.env.MODEL,
        messages: [
          {
            role: "system",
            content: "Você é um assistente educado dentro de um chatbot."
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

    reply = response.data.choices[0].message.content;

    if (!reply) {
      reply = fallbackResponse();
    }

    /*
    Salvar histórico
    */

    conversations[userId].push({
      role: "assistant",
      content: reply
    });

    /*
    Cache
    */

    responseCache[cacheKey] = reply;

    logConversation(userId, userMessage, reply);

    /*
    Streaming simulado
    */

    const finalReply = await simulateStreaming(reply, res);

    res.json({
      reply: finalReply
    });

  } catch (error) {

    console.error("Erro:", error.response?.data || error.message);

    res.json({
      reply: fallbackResponse()
    });

  }

});

module.exports = router;