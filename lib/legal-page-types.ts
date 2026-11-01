export type LegalPageStatus = 'brouillon' | 'publie'

export type LegalPageVersion = {
  id: string
  slug: 'conditions'
  version: number
  title: string
  body: string
  status: LegalPageStatus
  published_at: string | null
  created_at: string
  created_by: string | null
}
