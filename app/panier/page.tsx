import { redirect } from 'next/navigation'

type CartAliasProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function CartAlias({ searchParams }: CartAliasProps) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === 'string') query.set(key, value)
    else value?.forEach((entry) => query.append(key, entry))
  }
  redirect(`/checkout${query.size ? `?${query.toString()}` : ''}`)
}
