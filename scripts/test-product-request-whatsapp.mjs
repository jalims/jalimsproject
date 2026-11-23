function normalizeWhatsApp(value) {
  let cleaned = value.trim().replace(/[\s.\-()]/g, '')
  if (cleaned.startsWith('00')) {
    cleaned = `+${cleaned.slice(2)}`
  }

  if (/^\d{9}$/.test(cleaned) && /^(70|75|76|77|78)/.test(cleaned)) {
    return `+221${cleaned}`
  }

  if (/^\d{12}$/.test(cleaned) && cleaned.startsWith('221')) {
    return `+${cleaned}`
  }

  if (cleaned.startsWith('+') && /^\+\d{8,15}$/.test(cleaned)) {
    return cleaned
  }

  return null
}

const cases = [
  ['77 123 45 67', '+221771234567'],
  ['771234567', '+221771234567'],
  ['+221771234567', '+221771234567'],
  ['00221771234567', '+221771234567'],
  ['221771234567', '+221771234567'],
  ['+33612345678', '+33612345678'],
  ['12345', null],
  ['abc', null],
]

let failed = 0
for (const [input, expected] of cases) {
  const actual = normalizeWhatsApp(input)
  const ok = actual === expected
  if (!ok) failed++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${JSON.stringify(input)} -> ${JSON.stringify(actual)} (attendu ${JSON.stringify(expected)})`)
}

if (failed > 0) {
  console.error(`\n${failed} cas en échec`)
  process.exit(1)
}

console.log(`\n${cases.length} cas OK`)
