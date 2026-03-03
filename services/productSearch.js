const products = require("../data/products-embeddings.json");
const { getEmbedding } = require("./embeddingService");

/*
Normalização de query
*/
function normalizeQuery(query) {

  let q = query.toLowerCase();

  // remover acentos
  q = q.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const synonyms = {
    camisa: "camiseta",
    camisas: "camiseta",
    camiseta: "camiseta",
    camisetas: "camiseta",

    regata: "regata",
    regatas: "regata",

    blusa: "camiseta",
    blusas: "camiseta",

    polo: "camisa polo",

    jeans: "calca jeans",

    moletom: "moletom",
    moletons: "moletom",

    jaqueta: "jaqueta",
    jaquetas: "jaqueta",

    tenis: "tenis",
    sneaker: "tenis",
    sneakers: "tenis",

    bone: "bone",
    bones: "bone",

    cinto: "cinto",
    cintos: "cinto",

    shorts: "shorts",
    short: "shorts"
  };

  const words = q.split(" ");

  const normalized = words.map(word => synonyms[word] || word);

  return normalized.join(" ");
}

/*
Similaridade coseno
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

/*
Fallback keyword search
*/
function keywordSearch(query) {

  const q = query.toLowerCase();

  return products.filter(product =>
    product.name.toLowerCase().includes(q) ||
    product.description.toLowerCase().includes(q)
  ).slice(0, 5);

}

/*
Busca principal
*/
async function searchProducts(query) {

  const normalizedQuery = normalizeQuery(query);

  const queryEmbedding = await getEmbedding(normalizedQuery);

  const scored = products.map(product => {

    const score = cosineSimilarity(queryEmbedding, product.embedding);

    return {
      ...product,
      score
    };

  });

  scored.sort((a, b) => b.score - a.score);

  const semanticResults = scored
    .filter(p => p.score > 0.35)
    .slice(0, 5);

  /*
  fallback caso semantic search falhe
  */

  if (semanticResults.length === 0) {

    const keywordResults = keywordSearch(normalizedQuery);

    if (keywordResults.length > 0) {
      return keywordResults;
    }

  }

  return semanticResults;

}

module.exports = {
  searchProducts
};