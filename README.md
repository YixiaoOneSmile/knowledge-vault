# Knowledge Vault

一个用 Vue 3、Vite、Supabase 做的个人资料归档应用。支持登录、粘贴网站链接、上传文件、自动解析、调用 OpenAI 兼容大模型生成中文摘要并归档。

## 功能

- Supabase Auth 邮箱登录/注册
- 链接、文本、文件上传入口
- 私有 Supabase Storage 文件桶
- `archive_items` 归档表与 RLS 权限
- Supabase Edge Function 服务端解析与摘要，避免在浏览器暴露模型 key
- 支持 OpenAI 官方或代理兼容接口
- 网页优先使用 Firecrawl；没有 Firecrawl key 时自动直接抓取网页正文
- 图片使用视觉模型提取信息；纯文本、Markdown、CSV、JSON 直接解析

## 本地启动

```bash
cd /Users/robinsun/Project/knowledge-vault
npm install
cp .env.example .env
npm run dev
```

把 `.env` 填成你的 Supabase 项目：

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

## Supabase 初始化

安装 Supabase CLI 后，在项目里执行：

```bash
supabase link --project-ref your-project-ref
supabase db push
supabase functions deploy process-item
```

然后配置服务端密钥：

```bash
supabase secrets set \
  OPENAI_BASE_URL=https://你的代理地址/v1 \
  OPENAI_API_KEY=你的key \
  OPENAI_MODEL=gpt-4o-mini \
  OPENAI_VISION_MODEL=gpt-4o-mini
```

如果你有 Firecrawl key：

```bash
supabase secrets set FIRECRAWL_API_KEY=fc-xxxx
```

## 后续增强

PDF 和 DOCX 当前会先存档并生成文件级摘要说明。要做深度解析，可以在 `supabase/functions/process-item/index.ts` 的文件解析分支接入 LlamaParse、Unstructured、MinerU、自建 OCR/文档解析服务，或者把文档送到支持文件输入的大模型管线。
