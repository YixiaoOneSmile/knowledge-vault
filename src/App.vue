<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  Archive,
  BookOpenText,
  CheckCircle2,
  Clock3,
  FileText,
  Globe2,
  Image,
  LayoutDashboard,
  Link,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  UploadCloud,
} from 'lucide-vue-next'
import { ArchiveItem, supabase } from './lib/supabase'

const session = ref<Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']>(null)
const email = ref('')
const password = ref('')
const authMode = ref<'signin' | 'signup'>('signin')
const authLoading = ref(false)
const authError = ref('')

const urlInput = ref('')
const noteInput = ref('')
const uploadLoading = ref(false)
const items = ref<ArchiveItem[]>([])
const selected = ref<ArchiveItem | null>(null)
const query = ref('')
const statusFilter = ref<'all' | ArchiveItem['status']>('all')
const dragActive = ref(false)
const toast = ref('')

const filteredItems = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  return items.value.filter((item) => {
    const byStatus = statusFilter.value === 'all' || item.status === statusFilter.value
    const haystack = [item.title, item.summary, item.source_url, item.content_text, item.tags?.join(' ')]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return byStatus && (!keyword || haystack.includes(keyword))
  })
})

const readyCount = computed(() => items.value.filter((item) => item.status === 'ready').length)
const processingCount = computed(() => items.value.filter((item) => ['queued', 'processing'].includes(item.status)).length)
const failedCount = computed(() => items.value.filter((item) => item.status === 'failed').length)

onMounted(async () => {
  const { data } = await supabase.auth.getSession()
  session.value = data.session
  if (session.value) await loadItems()

  supabase.auth.onAuthStateChange((_event, nextSession) => {
    session.value = nextSession
    if (nextSession) loadItems()
    else items.value = []
  })
})

async function authenticate() {
  authLoading.value = true
  authError.value = ''
  const credentials = { email: email.value, password: password.value }
  const { error } =
    authMode.value === 'signin'
      ? await supabase.auth.signInWithPassword(credentials)
      : await supabase.auth.signUp(credentials)
  authLoading.value = false
  if (error) authError.value = error.message
}

async function loadItems() {
  const { data, error } = await supabase.from('archive_items').select('*').order('created_at', { ascending: false })
  if (error) {
    showToast(error.message)
    return
  }
  items.value = data ?? []
  selected.value = selected.value
    ? items.value.find((item) => item.id === selected.value?.id) ?? items.value[0] ?? null
    : items.value[0] ?? null
}

async function addUrl() {
  const sourceUrl = urlInput.value.trim()
  if (!sourceUrl) return
  uploadLoading.value = true
  const { data, error } = await supabase
    .from('archive_items')
    .insert({ kind: 'url', source_url: sourceUrl, title: sourceUrl, status: 'queued' })
    .select()
    .single()
  urlInput.value = ''
  uploadLoading.value = false
  if (error) return showToast(error.message)
  items.value = [data, ...items.value]
  selected.value = data
  await processItem(data.id)
}

async function addNote() {
  const text = noteInput.value.trim()
  if (!text) return
  uploadLoading.value = true
  const { data, error } = await supabase
    .from('archive_items')
    .insert({ kind: 'note', title: text.slice(0, 40), content_text: text, status: 'queued' })
    .select()
    .single()
  noteInput.value = ''
  uploadLoading.value = false
  if (error) return showToast(error.message)
  items.value = [data, ...items.value]
  selected.value = data
  await processItem(data.id)
}

async function uploadFiles(fileList: FileList | File[]) {
  const files = Array.from(fileList)
  if (!files.length || !session.value) return
  uploadLoading.value = true
  for (const file of files) {
    const path = `${session.value.user.id}/${crypto.randomUUID()}-${file.name}`
    const uploaded = await supabase.storage.from('archive-files').upload(path, file)
    if (uploaded.error) {
      showToast(uploaded.error.message)
      continue
    }
    const { data, error } = await supabase
      .from('archive_items')
      .insert({
        kind: 'file',
        title: file.name,
        storage_path: path,
        mime_type: file.type || 'application/octet-stream',
        status: 'queued',
      })
      .select()
      .single()
    if (error) showToast(error.message)
    else {
      items.value = [data, ...items.value]
      selected.value = data
      await processItem(data.id)
    }
  }
  uploadLoading.value = false
}

async function processItem(id: string) {
  await supabase.functions.invoke('process-item', { body: { itemId: id } })
  await loadItems()
}

function onDrop(event: DragEvent) {
  event.preventDefault()
  dragActive.value = false
  if (event.dataTransfer?.files) uploadFiles(event.dataTransfer.files)
}

function showToast(message: string) {
  toast.value = message
  window.setTimeout(() => (toast.value = ''), 3200)
}

function statusText(status: ArchiveItem['status']) {
  return {
    queued: '排队中',
    processing: '处理中',
    ready: '已完成',
    failed: '失败',
  }[status]
}

function kindText(kind: ArchiveItem['kind']) {
  return {
    url: '网页',
    file: '文件',
    note: '笔记',
  }[kind]
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date))
}
</script>

<template>
  <main v-if="!session" class="auth-page">
    <section class="auth-hero">
      <div class="auth-copy">
        <div class="product-badge"><Archive :size="18" /> Knowledge Vault</div>
        <h1>把散落的资料，变成可检索的个人知识库。</h1>
        <p>自动收集网页、图片、文档和临时笔记，提取关键信息，生成摘要，并按主题沉淀成长期资产。</p>
        <div class="trust-row">
          <span><ShieldCheck :size="16" /> 私有归档</span>
          <span><Sparkles :size="16" /> AI 摘要</span>
          <span><Globe2 :size="16" /> 网页解析</span>
        </div>
        <div class="preview-board">
          <div class="preview-card wide">
            <span class="mini-label">今日处理</span>
            <strong>18</strong>
            <small>网页、图片、PDF 与笔记</small>
          </div>
          <div class="preview-card">
            <CheckCircle2 :size="20" />
            <strong>92%</strong>
            <small>自动摘要完成率</small>
          </div>
          <div class="preview-card">
            <Clock3 :size="20" />
            <strong>1m</strong>
            <small>平均归档时间</small>
          </div>
        </div>
      </div>

      <div class="auth-panel">
        <div class="panel-heading">
          <div class="brand-mark"><Archive :size="24" /></div>
          <div>
            <span class="eyebrow">Secure workspace</span>
            <h2>{{ authMode === 'signin' ? '欢迎回来' : '创建工作区' }}</h2>
          </div>
        </div>

        <form class="auth-form" @submit.prevent="authenticate">
          <label>
            邮箱
            <input v-model="email" type="email" autocomplete="email" placeholder="you@example.com" required />
          </label>
          <label>
            密码
            <input v-model="password" type="password" autocomplete="current-password" placeholder="至少 6 位" required />
          </label>
          <p v-if="authError" class="error-text">{{ authError }}</p>
          <button class="primary-action" :disabled="authLoading">
            <Loader2 v-if="authLoading" class="spin" :size="18" />
            {{ authMode === 'signin' ? '进入工作台' : '创建账号' }}
          </button>
        </form>
        <button class="ghost-action" @click="authMode = authMode === 'signin' ? 'signup' : 'signin'">
          {{ authMode === 'signin' ? '没有账号？立即注册' : '已有账号？返回登录' }}
        </button>
      </div>
    </section>
  </main>

  <main v-else class="app-shell">
    <aside class="sidebar">
      <div class="sidebar-head">
        <div class="workspace-mark"><Archive :size="20" /></div>
        <div>
          <span class="eyebrow">AI Archive</span>
          <h1>Knowledge Vault</h1>
        </div>
      </div>

      <nav class="side-nav">
        <button class="active"><LayoutDashboard :size="18" /> 工作台</button>
        <button><BookOpenText :size="18" /> 全部资料</button>
        <button><Sparkles :size="18" /> 智能摘要</button>
      </nav>

      <div class="sidebar-card">
        <span class="mini-label">本月用量</span>
        <strong>{{ items.length }}/500</strong>
        <div class="usage-bar"><span :style="{ width: `${Math.min(items.length / 5, 100)}%` }" /></div>
        <small>当前为本地开发额度视图</small>
      </div>
    </aside>

    <section class="content">
      <header class="topbar">
        <div>
          <span class="eyebrow">Content Intelligence</span>
          <h2>资料收件箱</h2>
        </div>
        <div class="topbar-actions">
          <button class="icon-button" title="刷新" @click="loadItems"><RefreshCw :size="18" /></button>
          <button class="icon-button" title="退出登录" @click="supabase.auth.signOut()"><LogOut :size="18" /></button>
        </div>
      </header>

      <section class="metrics-row">
        <div class="metric-card accent">
          <span>总资料</span>
          <strong>{{ items.length }}</strong>
          <small>所有已归档内容</small>
        </div>
        <div class="metric-card">
          <span>已摘要</span>
          <strong>{{ readyCount }}</strong>
          <small>可直接检索复用</small>
        </div>
        <div class="metric-card">
          <span>处理中</span>
          <strong>{{ processingCount }}</strong>
          <small>正在解析和生成摘要</small>
        </div>
        <div class="metric-card">
          <span>失败</span>
          <strong>{{ failedCount }}</strong>
          <small>需要重新处理</small>
        </div>
      </section>

      <section class="capture-panel">
        <div class="capture-card">
          <div class="section-title">
            <span><Link :size="18" /> 添加链接</span>
            <small>网页正文会自动提取并摘要</small>
          </div>
          <label class="inline-input">
            <input v-model="urlInput" type="url" placeholder="https://example.com/article" @keyup.enter="addUrl" />
            <button class="icon-button filled" title="添加链接" :disabled="uploadLoading" @click="addUrl"><Plus :size="18" /></button>
          </label>
        </div>

        <div class="capture-card note-card">
          <div class="section-title">
            <span><FileText :size="18" /> 快速笔记</span>
            <small>临时想法也能归档</small>
          </div>
          <textarea v-model="noteInput" placeholder="粘贴会议记录、灵感、待整理文本..." rows="3" />
          <button class="secondary-action" :disabled="uploadLoading" @click="addNote">
            <Sparkles :size="17" /> 生成摘要
          </button>
        </div>

        <label
          class="drop-zone"
          :class="{ active: dragActive }"
          @dragenter.prevent="dragActive = true"
          @dragover.prevent
          @dragleave.prevent="dragActive = false"
          @drop="onDrop"
        >
          <UploadCloud :size="30" />
          <strong>上传图片或文档</strong>
          <span>支持图片、TXT、Markdown、CSV、PDF 等</span>
          <input type="file" multiple @change="event => uploadFiles((event.target as HTMLInputElement).files ?? [])" />
        </label>
      </section>

      <header class="toolbar">
        <label class="search">
          <Search :size="18" />
          <input v-model="query" placeholder="搜索标题、摘要、标签" />
        </label>
        <select v-model="statusFilter">
          <option value="all">全部状态</option>
          <option value="queued">排队中</option>
          <option value="processing">处理中</option>
          <option value="ready">已完成</option>
          <option value="failed">失败</option>
        </select>
      </header>

      <div class="workspace">
        <div class="item-list">
          <button
            v-for="item in filteredItems"
            :key="item.id"
            class="archive-row"
            :class="{ selected: selected?.id === item.id }"
            @click="selected = item"
          >
            <span class="status-dot" :class="item.status" />
            <span>
              <strong>{{ item.title || item.source_url || '未命名资料' }}</strong>
              <small>{{ item.summary || item.source_url || item.mime_type || '等待解析' }}</small>
              <em>{{ kindText(item.kind) }} · {{ statusText(item.status) }} · {{ formatDate(item.created_at) }}</em>
            </span>
          </button>
          <div v-if="!filteredItems.length" class="empty-state">
            <BookOpenText :size="34" />
            <p>资料会出现在这里。</p>
          </div>
        </div>

        <article class="detail-panel">
          <template v-if="selected">
            <div class="detail-top">
              <div class="detail-kicker">
                <span class="pill">{{ kindText(selected.kind) }}</span>
                <span class="pill muted">{{ statusText(selected.status) }}</span>
              </div>
              <span class="detail-date">{{ formatDate(selected.created_at) }}</span>
            </div>
            <h2>{{ selected.title || selected.source_url || '未命名资料' }}</h2>
            <a v-if="selected.source_url" :href="selected.source_url" target="_blank" rel="noreferrer">{{ selected.source_url }}</a>
            <section>
              <h3><Sparkles :size="17" /> 智能摘要</h3>
              <p class="summary-text">{{ selected.summary || selected.error_message || '正在等待解析和摘要。' }}</p>
            </section>
            <section v-if="selected.tags?.length">
              <h3>标签</h3>
              <div class="tag-row"><span v-for="tag in selected.tags" :key="tag">{{ tag }}</span></div>
            </section>
            <section v-if="selected.content_text">
              <h3>解析文本</h3>
              <pre>{{ selected.content_text }}</pre>
            </section>
          </template>
          <div v-else class="empty-detail">
            <Image :size="42" />
            <p>选择或添加一条资料开始归档。</p>
          </div>
        </article>
      </div>
    </section>

    <div v-if="toast" class="toast">{{ toast }}</div>
  </main>
</template>
