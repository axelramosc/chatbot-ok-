import { embed } from "ai";
import { gateway } from "@ai-sdk/gateway";

const EMBEDDING_MODEL = "openai/text-embedding-3-small";

export async function generateEmbedding(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: gateway.embeddingModel(EMBEDDING_MODEL),
    value: text,
  });
  return embedding;
}
