const fs = require("fs");
const path = require("path");
const { getEmbedding } = require("../services/embeddingService");

const products = require("../data/products.json");

async function run() {

  const result = [];

  for (const product of products) {

    const text = `${product.name} ${product.description}`;

    const embedding = await getEmbedding(text);

    result.push({
      ...product,
      embedding
    });

    console.log("Embedding gerado:", product.name);

  }

  fs.writeFileSync(
    path.join(__dirname, "../data/products-embeddings.json"),
    JSON.stringify(result, null, 2)
  );

  console.log("Embeddings salvos!");

}

run();

// Depois de mudar o dataset: node scripts/generateEmbeddings.js