import { redirect } from 'next/navigation'

type ProductAliasProps = {
  params: Promise<{ id: string }>
}

export default async function ProductAlias({ params }: ProductAliasProps) {
  const { id } = await params
  redirect(`/products/${encodeURIComponent(id)}`)
}
