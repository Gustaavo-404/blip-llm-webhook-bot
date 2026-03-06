const products = require("../data/products-embeddings.json");
const { getEmbedding } = require("./embeddingService");

// ==================== CONSTANTES CENTRALIZADAS ====================
const productSynonyms = {
  camiseta: ["camiseta", "camisa", "tshirt", "t-shirt", "tee"],
  regata: ["regata", "tank", "tanktop", "camisa regata", "camiseta regata"],
  calca: ["calça", "calca", "pants", "trouser"],
  bermuda: ["bermuda", "short", "shorts"],
  tenis: ["tenis", "tênis", "sneaker", "shoe"],
  cinto: ["cinto", "belt", "leather belt", "couro"],
  jaqueta: ["jaqueta", "jacket", "jaquetas"],
  bone: ["bone", "boné", "cap"],
  moletom: ["moletom", "moletons", "hoodie"],
  shorts: ["shorts", "short"]
};

// Conjunto plano de todos os sinônimos (para buscas rápidas)
const allSynonyms = new Set();
Object.values(productSynonyms).forEach(list => list.forEach(syn => allSynonyms.add(syn)));

// Palavras que indicam pedido de variação
const variationKeywords = [
  "outra cor", "outro", "diferente", "variação", 
  "outros", "outras cores", "outro modelo", "diferente desse"
];

// ==================== FUNÇÕES AUXILIARES ====================

/**
 * Extrai a categoria do produto a partir da consulta do usuário
 * usando a lista de sinônimos centralizada.
 */
function extractCategoryFromQuery(query) {
  const q = query.toLowerCase();
  for (const [category, synonyms] of Object.entries(productSynonyms)) {
    for (const syn of synonyms) {
      if (q.includes(syn)) {
        return category;
      }
    }
  }
  return null;
}

/**
 * Normaliza a consulta substituindo sinônimos pelos termos canônicos.
 */
function normalizeQuery(query) {
  let q = query.toLowerCase();
  // Remove acentos
  q = q.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const words = q.split(" ");
  const normalized = words.map(word => {
    // Tenta encontrar o sinônimo em productSynonyms (mapeamento reverso)
    for (const [category, synonyms] of Object.entries(productSynonyms)) {
      if (synonyms.includes(word)) {
        return category; // substitui pelo nome canônico da categoria
      }
    }
    return word;
  });
  return normalized.join(" ");
}

/**
 * Verifica se a consulta é do tipo variação (ex: "outra cor").
 */
function isVariationQuery(query) {
  const q = query.toLowerCase();
  return variationKeywords.some(keyword => q.includes(keyword));
}

/**
 * Calcula a similaridade de cosseno entre dois vetores.
 */
function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Busca por palavra-chave (fallback).
 */
function keywordSearch(query) {
  const q = query.toLowerCase();
  return products.filter(product =>
    product.name.toLowerCase().includes(q) ||
    product.description.toLowerCase().includes(q)
  ).slice(0, 5);
}

// ==================== FUNÇÃO PRINCIPAL ====================

async function searchProducts(query, lastCategory = null) {
  const normalizedQuery = normalizeQuery(query);
  console.log(`[searchProducts] Query: "${query}" | Normalized: "${normalizedQuery}" | lastCategory: ${lastCategory}`);

  // 1. Detecta a categoria mencionada na consulta atual (se houver)
  const currentCategory = extractCategoryFromQuery(query);

  // 2. Se for consulta de variação, usa a categoria atual (se existir) ou a última
  if (isVariationQuery(query)) {
    const targetCategory = currentCategory || lastCategory;
    if (targetCategory) {
      console.log(`[searchProducts] Consulta de variação. Retornando produtos da categoria: ${targetCategory}`);
      const categoryProducts = products.filter(p => p.category === targetCategory).slice(0, 5);
      if (categoryProducts.length > 0) {
        return categoryProducts;
      }
    }
  }

  // 3. Busca semântica normal
  const queryEmbedding = await getEmbedding(normalizedQuery);
  const scored = products.map(product => {
    const score = cosineSimilarity(queryEmbedding, product.embedding);
    return { ...product, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const semanticResults = scored.slice(0, 5);
  console.log(`[searchProducts] Top 5 scores:`, semanticResults.map(p => ({ id: p.id, name: p.name, score: p.score })));

  if (semanticResults.length > 0 && semanticResults[0].score > 0.2) {
    console.log(`[searchProducts] Retornando semântico`);
    return semanticResults;
  }

  // 4. Fallback keyword
  const keywordResults = keywordSearch(normalizedQuery);
  console.log(`[searchProducts] Keyword results:`, keywordResults.map(p => p.name));
  if (keywordResults.length > 0) {
    return keywordResults;
  }

  // 5. Fallback contextual pela última categoria (se existir)
  if (lastCategory) {
    console.log(`[searchProducts] Fallback por categoria: ${lastCategory}`);
    const categoryProducts = products.filter(p => p.category === lastCategory).slice(0, 5);
    if (categoryProducts.length > 0) {
      return categoryProducts;
    }
  }

  return [];
}

module.exports = { searchProducts };