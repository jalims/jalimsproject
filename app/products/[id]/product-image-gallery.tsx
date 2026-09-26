'use client'

import Image from 'next/image'
import { useRef, useState } from 'react'

type GalleryImage = {
  id: string
  image_url: string
}

export default function ProductImageGallery({ images, productName }: { images: GalleryImage[]; productName: string }) {
  const [activeIndex, setActiveIndex] = useState(0)
  const pointerStart = useRef<number | null>(null)

  function moveImage(direction: -1 | 1) {
    setActiveIndex((current) => (current + direction + images.length) % images.length)
  }

  function endSwipe(pointerEnd: number) {
    if (pointerStart.current === null) return
    const distance = pointerEnd - pointerStart.current
    if (Math.abs(distance) > 45) moveImage(distance < 0 ? 1 : -1)
    pointerStart.current = null
  }

  if (images.length === 0) {
    return <div className="detail-image"><span className="image-placeholder" aria-hidden="true">J</span></div>
  }

  const activeImage = images[activeIndex]

  return (
    <div className="detail-gallery">
      <div
        className="detail-image detail-gallery-viewport"
        onPointerDown={(event) => { pointerStart.current = event.clientX }}
        onPointerUp={(event) => endSwipe(event.clientX)}
        onPointerCancel={() => { pointerStart.current = null }}
        onDragStart={(event) => event.preventDefault()}
        aria-label={`Photo ${activeIndex + 1} sur ${images.length} pour ${productName}`}
      >
        <Image src={activeImage.image_url} alt={`${productName}, photo ${activeIndex + 1}`} fill sizes="(max-width: 760px) 100vw, 55vw" unoptimized priority={activeIndex === 0} draggable={false} key={activeImage.id} />
        {images.length > 1 && (
          <>
            <button className="gallery-arrow gallery-arrow-previous" type="button" onClick={() => moveImage(-1)} aria-label="Photo précédente">‹</button>
            <button className="gallery-arrow gallery-arrow-next" type="button" onClick={() => moveImage(1)} aria-label="Photo suivante">›</button>
            <span className="gallery-counter">{activeIndex + 1} / {images.length}</span>
          </>
        )}
      </div>
      {images.length > 1 && (
        <div className="detail-gallery-thumbnails" aria-label="Choisir une photo du produit">
          {images.map((image, index) => (
            <button
              className={`detail-gallery-thumbnail${index === activeIndex ? ' active' : ''}`}
              type="button"
              key={image.id}
              aria-label={`Afficher la photo ${index + 1}`}
              aria-pressed={index === activeIndex}
              onClick={() => setActiveIndex(index)}
            >
              <Image src={image.image_url} alt="" fill sizes="96px" unoptimized />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
