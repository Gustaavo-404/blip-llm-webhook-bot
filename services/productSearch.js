const products = require("../data/products-embeddings.json");
const { getEmbedding } = require("./embeddingService");
const { cosineSimilarity } = require("./vectorUtils");

async function searchProducts(query) {

  const queryEmbedding = await getEmbedding(query);

  const scored = products.map(product => {

    const similarity = cosineSimilarity(
      queryEmbedding,
      product.embedding
    );

    return {
      ...product,
      score: similarity
    };

  });

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, 3);

}

module.exports = {
  searchProducts
};