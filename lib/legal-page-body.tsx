import type { ReactNode } from 'react'

function renderBold(text: string): ReactNode[] {
  return text.split(/(\*\*.+?\*\*)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>
    }
    return part
  })
}

export function LegalPageBody({ body }: { body: string }) {
  const lines = body.split(/\r?\n/)
  const blocks: ReactNode[] = []

  for (let index = 0; index < lines.length;) {
    const line = lines[index].trim()
    if (!line) {
      index += 1
      continue
    }

    if (line.startsWith('## ')) {
      blocks.push(<h2 key={`heading-${index}`}>{renderBold(line.slice(3))}</h2>)
      index += 1
      continue
    }

    if (line.startsWith('- ')) {
      const items: string[] = []
      while (index < lines.length && lines[index].trim().startsWith('- ')) {
        items.push(lines[index].trim().slice(2))
        index += 1
      }
      blocks.push(
        <ul key={`list-${index}`}>
          {items.map((item, itemIndex) => <li key={itemIndex}>{renderBold(item)}</li>)}
        </ul>,
      )
      continue
    }

    blocks.push(<p key={`paragraph-${index}`}>{renderBold(line)}</p>)
    index += 1
  }

  return <div className="legal-page-body">{blocks}</div>
}
