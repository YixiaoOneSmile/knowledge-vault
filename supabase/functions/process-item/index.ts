import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type ArchiveItem = {
  id: string
  user_id: string
  kind: 'url' | 'file' | 'note'
  title: string | null
  source_url: string | null
  storage_path: string | null
  mime_type: string | null
  content_text: string | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  let itemId = ''
  try {
    const body = await req.json()
    itemId = body.itemId
    if (!itemId) throw new Error('Missing itemId')

    const supabaseUrl = requireEnv('SUPABASE_URL')
    const supabaseAnonKey = requireEnv('SUPABASE_ANON_KEY')
    const authHeader = req.headers.get('Authorization') ?? ''
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: item, error: itemError } = await supabase
      .from('archive_items')
      .select('*')
      .eq('id', itemId)
      .single<ArchiveItem>()

    if (itemError) throw itemError
    if (!item) throw new Error('Archive item not found')

    await supabase.from('archive_items').update({ status: 'processing', error_message: null }).eq('id', item.id)

    const parsed = await parseItem(supabase, item)
    const summary = await summarize(parsed)

    const { error: updateError } = await supabase
      .from('archive_items')
      .update({
        title: summary.title || parsed.title || item.title,
        summary: summary.summary,
        content_text: parsed.text.slice(0, 18000),
        tags: summary.tags,
        status: 'ready',
        error_message: null,
      })
      .eq('id', item.id)

    if (updateError) throw updateError

    return json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    try {
      const supabase = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_ANON_KEY'), {
        global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      })
      if (itemId) {
        await supabase.from('archive_items').update({ status: 'failed', error_message: message }).eq('id', itemId)
      }
    } catch {
      // Best-effort failure update.
    }
    return json({ ok: false, error: message }, 400)
  }
})

async function parseItem(supabase: ReturnType<typeof createClient>, item: ArchiveItem) {
  if (item.kind === 'note') {
    return {
      title: item.title ?? '文本笔记',
      text: item.content_text ?? '',
      source: 'note',
    }
  }

  if (item.kind === 'url') {
    const sourceUrl = item.source_url ?? ''
    const firecrawl = Deno.env.get('FIRECRAWL_API_KEY')
    if (firecrawl) {
      const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${firecrawl}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: sourceUrl,
          formats: ['markdown'],
          onlyMainContent: true,
        }),
      })
      if (response.ok) {
        const payload = await response.json()
        return {
          title: payload.data?.metadata?.title ?? item.title ?? sourceUrl,
          text: payload.data?.markdown ?? '',
          source: 'firecrawl',
        }
      }
    }

    const response = await fetch(sourceUrl)
    const html = await response.text()
    return {
      title: extractTitle(html) ?? item.title ?? sourceUrl,
      text: htmlToText(html),
      source: 'direct-fetch',
    }
  }

  if (item.kind === 'file' && item.storage_path) {
    const { data, error } = await supabase.storage.from('archive-files').download(item.storage_path)
    if (error) throw error

    const mimeType = item.mime_type ?? data.type
    const filename = item.title ?? item.storage_path.split('/').pop() ?? '文件'

    if (mimeType.startsWith('text/') || /json|csv|markdown|xml/.test(mimeType)) {
      return {
        title: filename,
        text: await data.text(),
        source: mimeType,
      }
    }

    if (mimeType.startsWith('image/')) {
      const signed = await supabase.storage.from('archive-files').createSignedUrl(item.storage_path, 60 * 10)
      const imageUrl = signed.data?.signedUrl
      const text = imageUrl
        ? await describeImage(imageUrl, filename)
        : `图片文件：${filename}。当前无法生成临时访问链接。`
      return { title: filename, text, source: mimeType }
    }

    return {
      title: filename,
      text: `已归档文件：${filename}\n类型：${mimeType}\n大小：${data.size} bytes\n\n当前版本已支持网页、图片和纯文本解析。PDF、DOCX 可后续接入 LlamaParse、Unstructured、MinerU 或自建解析服务。`,
      source: mimeType,
    }
  }

  throw new Error('Unsupported archive item')
}

async function summarize(parsed: { title: string; text: string; source: string }) {
  const baseUrl = Deno.env.get('OPENAI_BASE_URL') ?? 'https://api.openai.com/v1'
  const apiKey = requireEnv('OPENAI_API_KEY')
  const model = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini'
  const content = parsed.text.slice(0, 24000)

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            '你是个人知识库归档助手。请输出 JSON：{"title":"简短标题","summary":"150-250字中文摘要","tags":["3到6个中文标签"]}。',
        },
        {
          role: 'user',
          content: `来源：${parsed.source}\n原始标题：${parsed.title}\n内容：\n${content}`,
        },
      ],
    }),
  })

  if (!response.ok) throw new Error(`LLM request failed: ${response.status} ${await response.text()}`)
  const payload = await response.json()
  const raw = payload.choices?.[0]?.message?.content ?? '{}'
  const parsedJson = JSON.parse(raw)

  return {
    title: String(parsedJson.title ?? parsed.title).slice(0, 120),
    summary: String(parsedJson.summary ?? '摘要生成失败。'),
    tags: Array.isArray(parsedJson.tags) ? parsedJson.tags.map(String).slice(0, 6) : [],
  }
}

async function describeImage(imageUrl: string, filename: string) {
  const baseUrl = Deno.env.get('OPENAI_BASE_URL') ?? 'https://api.openai.com/v1'
  const apiKey = requireEnv('OPENAI_API_KEY')
  const model = Deno.env.get('OPENAI_VISION_MODEL') ?? Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini'

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: `请用中文提取这张图片的主要信息，文件名：${filename}` },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
    }),
  })

  if (!response.ok) return `图片文件：${filename}。视觉解析失败：${response.status}`
  const payload = await response.json()
  return payload.choices?.[0]?.message?.content ?? `图片文件：${filename}`
}

function htmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50000)
}

function extractTitle(html: string) {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  return match?.[1]?.replace(/\s+/g, ' ').trim()
}

function requireEnv(name: string) {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing env: ${name}`)
  return value
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
