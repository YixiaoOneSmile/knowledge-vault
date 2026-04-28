import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.')
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '')

export type ArchiveItem = {
  id: string
  user_id: string
  kind: 'url' | 'file' | 'note'
  title: string | null
  source_url: string | null
  storage_path: string | null
  mime_type: string | null
  status: 'queued' | 'processing' | 'ready' | 'failed'
  summary: string | null
  content_text: string | null
  tags: string[] | null
  error_message: string | null
  created_at: string
  updated_at: string
}
