import Image from 'next/image'
import Link from 'next/link'
import {
  ArrowRight,
  CheckCircle2,
  CreditCard,
  Headphones,
  Package,
  ShoppingBag,
  Truck,
  Wallet,
} from 'lucide-react'
import {
  homepageAssetUrl,
  type HomepageBenefitIcon,
  type HomepageDesignContent,
  type HomepageStepIcon,
} from '../../lib/homepage-content'

const benefitIconComponents = {
  wallet: Wallet,
  truck: Truck,
  support: Headphones,
} satisfies Record<HomepageBenefitIcon, typeof Wallet>

const stepIconComponents = {
  shopping: ShoppingBag,
  package: Package,
  payment: CreditCard,
  check: CheckCircle2,
} satisfies Record<HomepageStepIcon, typeof ShoppingBag>

export function HomepageTopBand({ design }: { design: HomepageDesignContent }) {
  return (
    <div className="home-redesign-top-band">
      <p><Truck aria-hidden="true" size={17} /> {design.announcementText}</p>
      <Link href={design.announcementHref}>
        {design.announcementLinkText} <ArrowRight aria-hidden="true" size={16} />
      </Link>
    </div>
  )
}

export function HomepageHero({ design }: { design: HomepageDesignContent }) {
  const desktopImage = homepageAssetUrl(design.heroDesktopImagePath)
  const mobileImage = homepageAssetUrl(design.heroMobileImagePath)
  const fallbackImage = desktopImage ?? mobileImage

  return (
    <section className="home-redesign-hero" aria-label={design.heroKicker}>
      {fallbackImage && (
        <picture className="home-redesign-hero-picture">
          {mobileImage && <source media="(max-width: 700px)" srcSet={mobileImage} />}
          <Image
            src={fallbackImage}
            alt={design.heroAlt}
            fill
            sizes="(max-width: 700px) 100vw, 1180px"
            unoptimized
            preload
          />
        </picture>
      )}
      <div className="home-redesign-hero-copy">
        <p className="home-redesign-kicker">{design.heroKicker}</p>
        <h1>
          <span>{design.heroTitleLine1}</span>
          <span className="home-redesign-highlight">{design.heroTitleHighlight}</span>
        </h1>
        <p className="home-redesign-hero-subtitle">{design.heroSubtitle}</p>
        <Link className="home-redesign-hero-button" href={design.heroButtonHref}>
          {design.heroButtonText} <ArrowRight aria-hidden="true" size={18} />
        </Link>
      </div>
    </section>
  )
}

export function HomepageBenefits({ design }: { design: HomepageDesignContent }) {
  return (
    <section className="home-redesign-benefits" aria-label={design.benefits.map((benefit) => `${benefit.firstLine} ${benefit.secondLine}`).join('; ')}>
      {design.benefits.map((benefit, index) => {
        const Icon = benefitIconComponents[benefit.icon]
        return (
          <div className="home-redesign-benefit" key={`${benefit.icon}-${index}`}>
            <Icon aria-hidden="true" size={21} strokeWidth={2} />
            <span><strong>{benefit.firstLine}</strong><small>{benefit.secondLine}</small></span>
          </div>
        )
      })}
    </section>
  )
}

export function HomepageFeaturedHeading({ design }: { design: HomepageDesignContent }) {
  return (
    <div className="home-redesign-section-heading">
      <h2>{design.featuredTitle}</h2>
      <Link href={design.featuredHref}>{design.featuredLinkText} <ArrowRight aria-hidden="true" size={16} /></Link>
    </div>
  )
}

export function HomepageProcess({ design }: { design: HomepageDesignContent }) {
  const processImage = homepageAssetUrl(design.processImagePath)

  return (
    <section className={`home-redesign-process${processImage ? '' : ' home-redesign-process-no-image'}`} id="how-it-works" aria-labelledby="home-redesign-process-title">
      <div className="home-redesign-process-copy">
        <p className="home-redesign-eyebrow">{design.processEyebrow}</p>
        <h2 id="home-redesign-process-title">{design.processTitle}</h2>
        <ol className="home-redesign-steps">
          {design.processSteps.map((step, index) => {
            const Icon = stepIconComponents[step.icon]
            return (
              <li className={index === 1 ? 'home-redesign-step home-redesign-step-featured' : 'home-redesign-step'} key={`${step.icon}-${index}`}>
                <span className="home-redesign-step-icon"><Icon aria-hidden="true" size={21} /></span>
                <span className="home-redesign-step-number">0{index + 1}</span>
                <strong>{step.title}</strong>
              </li>
            )
          })}
        </ol>
      </div>
      {processImage && (
        <div className="home-redesign-process-image">
          <Image
            src={processImage}
            alt={design.processImageAlt}
            fill
            sizes="(max-width: 760px) 100vw, 360px"
            unoptimized
            loading="lazy"
          />
        </div>
      )}
    </section>
  )
}

export function HomepageDesignPreview({ design }: { design: HomepageDesignContent }) {
  return (
    <div className="home-redesign-preview">
      <HomepageTopBand design={design} />
      <HomepageHero design={design} />
      <HomepageBenefits design={design} />
      <section className="home-redesign-featured-preview">
        <HomepageFeaturedHeading design={design} />
        <p>{design.featuredEmptyText}</p>
      </section>
      <HomepageProcess design={design} />
    </div>
  )
}
