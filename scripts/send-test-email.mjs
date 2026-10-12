import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { Resend } from 'resend'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = resolve(projectRoot, '.env.local')
const recipient = process.argv[2]?.trim()

if (
  !recipient
  || !/^[a-z\d.!#$%&'*+/=?^_`{|}~-]+@[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?)+$/i.test(recipient)
) {
  console.error('Utilisation : node scripts/send-test-email.mjs adresse@exemple.com')
  process.exitCode = 1
} else {
  let envFile
  try {
    envFile = await readFile(envPath, 'utf8')
  } catch {
    console.error('Impossible de lire .env.local à la racine du projet.')
    process.exitCode = 1
  }

  if (envFile !== undefined) {
    const keyLine = envFile.match(/^\s*(?:export\s+)?RESEND_API_KEY\s*=\s*(.*?)\s*$/m)
    const apiKey = keyLine?.[1]?.replace(/^(["'])(.*)\1$/, '$2').trim()

    if (!apiKey) {
      console.error('RESEND_API_KEY est absente de .env.local.')
      process.exitCode = 1
    } else {
      const readline = createInterface({ input: stdin, output: stdout })
      const confirmation = await readline.question(`Envoyer le courriel de test à ${recipient} ? (oui/non) `)
      readline.close()

      if (confirmation.trim().toLowerCase() !== 'oui') {
        console.log('Envoi annulé.')
      } else {
        const resend = new Resend(apiKey)
        const { data, error } = await resend.emails.send({
          from: 'Jalims <commandes@jalims.com>',
          to: recipient,
          subject: 'Test de confirmation de commande — Jalims',
          text: `Bonjour Aminata, merci ! Nous avons bien reçu votre paiement de 25 000 FCFA pour la commande JAL-TEST-0001.

Sac en toile
- Couleur : Bleu — 2 unités
- Couleur : Noir — 1 unité

Prochaine étape : nous commandons votre produit chez le fournisseur, puis il voyage jusqu'au Sénégal. Délai estimé : 5 à 12 jours. Nous vous écrivons aux étapes importantes. Suivre ma commande : https://jalims.com/orders. Une question ? WhatsApp +221 77 000 00 00.`,
          html: '<div>Bonjour Aminata, merci ! Nous avons bien reçu votre paiement de 25 000 FCFA pour la commande JAL-TEST-0001.<br><br>Sac en toile<br>- Couleur : Bleu — 2 unités<br>- Couleur : Noir — 1 unité<br><br>Prochaine étape : nous commandons votre produit chez le fournisseur, puis il voyage jusqu’au Sénégal. Délai estimé : 5 à 12 jours. Nous vous écrivons aux étapes importantes. Suivre ma commande : https://jalims.com/orders. Une question ? WhatsApp +221 77 000 00 00.</div>',
        })

        if (error) {
          console.error('Resend a refusé le courriel de test :', error.message)
          process.exitCode = 1
        } else {
          console.log(`Courriel de test accepté par Resend. Identifiant : ${data.id}`)
        }
      }
    }
  }
}
