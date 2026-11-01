import Link from 'next/link'
import { LegalPageBody } from '../../lib/legal-page-body'
import { getLatestPublishedLegalPage } from '../../lib/legal-pages'

export const dynamic = 'force-dynamic'

export default async function ConditionsPage() {
  const page = await getLatestPublishedLegalPage()

  return (
    <main className="legal-page">
      <article className="legal-page-shell">
        <Link className="legal-page-back" href="/">← Retour à la boutique</Link>
        {page ? (
          <>
            <header className="legal-page-header">
              <p className="eyebrow">JALIMS · INFORMATIONS LÉGALES</p>
              <h1>{page.title}</h1>
              <p>Version {page.version} · Publiée le {new Date(page.published_at ?? page.created_at).toLocaleDateString('fr-FR', { dateStyle: 'long' })}</p>
            </header>
            <LegalPageBody body={page.body} />
          </>
        ) : (
          <section className="legal-page-empty">
            <p className="eyebrow">JALIMS · INFORMATIONS LÉGALES</p>
            <h1>Conditions générales</h1>
            <p>Nos conditions seront bientôt disponibles</p>
          </section>
        )}
      </article>
    </main>
  )
}
