import { Hono } from 'hono'
import { streamSSE, streamText } from 'hono/streaming'
import { openai } from './llm/openai'
import { anthropic, anthropicVertex } from './llm/anthropic'
import OpenAI from 'openai'
import { google } from './llm/google'
import { deepseek } from './llm/deepseek'
import { serializeError } from 'serialize-error'
import { HTTPException } from 'hono/http-exception'
import { cors } from 'hono/cors'
import { moonshot } from './llm/moonshot'
import { lingyiwanwu } from './llm/lingyiwanwu'
import { groq } from './llm/groq'
import { auzreOpenAI } from './llm/azure'
import { bailian } from './llm/bailian'
import { cohere } from './llm/cohere'

interface Bindings {
  API_KEY: string
  OPENAI_API_KEY: string
}

function getModels(env: Record<string, string>) {
  return [
    openai(env),
    anthropic(env),
    anthropicVertex(env),
    google(env),
    deepseek(env),
    moonshot(env),
    lingyiwanwu(env),
    groq(env),
    auzreOpenAI(env),
    cohere(env),
    bailian(env),
  ].filter((it) => it.requiredEnv.every((it) => it in env))
}

// 生成 openai chat 的代理，https://api.openai.com/v1/chat/completions
const app = new Hono<{
  Bindings: Bindings
}>()
  /*
curl https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
     "model": "gpt-4o-mini",
     "messages": [{"role": "user", "content": "Say this is a test!"}],
     "temperature": 0.7
   }'
*/
  .use(
    cors({
      origin: (_origin, c) => {
        return c.env.CORS_ORIGIN
      },
    }),
  )
  .use(async (c, next) => {
    await next()
    if (c.error) {
      throw new HTTPException((c.error as any)?.status ?? 500, {
        message: serializeError(c.error).message,
      })
    }
  })
  .options('/v1/chat/completions', async (c) => {
    return c.json({ body: 'ok' })
  })
  .use(async (c, next) => {
    if (!c.env.API_KEY) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    if (`Bearer ${c.env.API_KEY}` !== c.req.header('Authorization')) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    return next()
  })
  .post('/v1/chat/completions', async (c) => {
    
  c.header('Content-Encoding', 'Identity')
    const req = (await c.req.json()) as
      | OpenAI.ChatCompletionCreateParamsNonStreaming
      | OpenAI.ChatCompletionCreateParamsStreaming
    const list = getModels(c.env as any)
    const llm = list.find((it) => it.supportModels.includes(req.model))
    if (!llm) {
      return c.json({ error: `Model ${req.model} not supported` }, 400)
    }

    if (req.stream) {
      const abortController = new AbortController()
      console.log ("STREAMING");

      return streamText(c, async (stream) => {
        
        console.log ("IN STREAM");
        stream.onAbort(() => abortController.abort())
        console.log ("INVOKING");
        const openaiResponse = await llm?.invoke(req);
        const [message] = openaiResponse.choices;
        const resp = {
          id: openaiResponse.id,
          "object": "chat.completion.chunk",
          created: openaiResponse.created,
          model: openaiResponse.model,
          choices: [{
              index: 0,
              finish_reason: message.finish_reason,
              delta: {
                  content: message.message.content,
                  "role": message.message.role
              },

          }]
        };

        console.log ("RESPONSE", JSON.stringify(resp));

        stream.write(JSON.stringify( resp ))
      })
      /*return streamSSE(c, async (stream) => {
        console.log ("IN STREAM");
        stream.onAbort(() => abortController.abort())
        console.log ("INVOKING");
        const openaiResponse = await llm?.invoke(req);
        console.log ("RESPONSE", JSON.stringify(openaiResponse));

        stream.stream({ data: JSON.stringify(openaiResponse) })
      })*/
    }

    req.stream = false;
    const openaiResponse = await llm?.invoke(req);
    
    return c.json(openaiResponse)
  })
  .get('/v1/models', async (c) => {
    return c.json({
      object: 'list',
      data: getModels(c.env as any).flatMap((it) =>
        it.supportModels.map(
          (model) =>
            ({
              id: model,
              object: 'model',
              owned_by: it.name,
              created: Math.floor(Date.now() / 1000),
            } as OpenAI.Models.Model),
        ),
      ),
    } as OpenAI.Models.ModelsPage)
  })

export default app
