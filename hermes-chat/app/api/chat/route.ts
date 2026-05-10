import { streamText, convertToModelMessages } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { getHermesBaseUrl, getHermesToken, getChatModel } from "@/lib/hermes-config";

export async function POST(req: Request) {
  const base = getHermesBaseUrl();
  const token = getHermesToken();
  if (!base || !token) {
    return Response.json(
      {
        error:
          "Server misconfiguration: set HERMES_URL and HERMES_TOKEN (or OPENCLAW_*) in .env.local.",
      },
      { status: 503 }
    );
  }

  const { messages } = await req.json();

  const client = createOpenAI({
    baseURL: `${base.replace(/\/$/, "")}/v1`,
    apiKey: token,
  });

  const modelId = getChatModel();

  const result = streamText({
    model: client.chat(modelId),
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}
