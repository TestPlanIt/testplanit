import { type ReactNode, useState, useEffect, useCallback } from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import useEmblaCarousel from 'embla-carousel-react';
import Autoplay from 'embla-carousel-autoplay';
import {
  Wand2,
  Link as LinkIcon,
  Shield,
  Search,
  FolderTree,
  Compass,
  ChartNoAxesCombined,
  Globe,
  Server,
  ScrollText,
  Tags,
} from 'lucide-react';
import { AdUnit } from '../components/AdUnit';

import styles from './index.module.css';

function HomepageHeader() {
  return (
    <header className={styles.heroSection}>
      {/* Animated background blobs */}
      <div className={styles.blobContainer}>
        <div className={clsx(styles.blob, styles.blob1, 'animate-blob')} />
        <div
          className={clsx(
            styles.blob,
            styles.blob2,
            'animate-blob',
            'animation-delay-2000'
          )}
        />
        <div
          className={clsx(
            styles.blob,
            styles.blob3,
            'animate-blob',
            'animation-delay-4000'
          )}
        />
      </div>

      <div className="container">
        <div className={styles.heroContent}>
          <Heading
            as="h1"
            className={clsx(
              styles.heroTitle,
              'gradient-text',
              'animate-gradient-x'
            )}
          >
            TestPlanIt Documentation
          </Heading>

          <p className={styles.heroSubtitle}>
            Open Source Modern Test Management for Agile Teams
          </p>

          <div className={styles.buttons}>
            <Link className={styles.primaryButton} to="/docs/">
              Get Started
              <span className={styles.buttonArrow}>→</span>
            </Link>
            <Link
              className={styles.secondaryButton}
              href="https://github.com/testplanit/testplanit"
              target="_blank"
              rel="noopener noreferrer"
            >
              View on GitHub <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}

const screenshots = [
  {
    src: '/img/test-cases.png',
    alt: 'TestPlanIt test case management interface showing test repository, folders, and test cases',
    label: 'Test Cases',
  },
  {
    src: '/img/test-runs.png',
    alt: 'TestPlanIt test runs and results dashboard with execution summary and trend charts',
    label: 'Test Runs',
  },
  {
    src: '/img/sessions.png',
    alt: 'TestPlanIt exploratory testing sessions with results summary',
    label: 'Sessions',
  },
  {
    src: '/img/reports.png',
    alt: 'TestPlanIt reporting interface with custom report builder and visualizations',
    label: 'Reports',
  },
];

function HomepageScreenshot() {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true }, [
    Autoplay({ delay: 5000, stopOnInteraction: false, stopOnMouseEnter: true }),
  ]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const scrollTo = useCallback(
    (index: number) => emblaApi?.scrollTo(index),
    [emblaApi]
  );

  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => setSelectedIndex(emblaApi.selectedScrollSnap());
    emblaApi.on('select', onSelect);
    onSelect();
    return () => {
      emblaApi.off('select', onSelect);
    };
  }, [emblaApi]);

  return (
    <section className={styles.screenshotSection}>
      <div className="container">
        <div className={styles.screenshotViewport} ref={emblaRef}>
          <div className={styles.screenshotContainer}>
            {screenshots.map((shot, index) => (
              <div key={shot.src} className={styles.screenshotSlide}>
                <img
                  src={shot.src}
                  alt={shot.alt}
                  className={styles.screenshotImage}
                  loading={index === 0 ? 'eager' : 'lazy'}
                />
              </div>
            ))}
          </div>
        </div>
        <div className={styles.screenshotDots}>
          {screenshots.map((shot, index) => (
            <button
              key={shot.src}
              type="button"
              className={clsx(
                styles.screenshotDot,
                index === selectedIndex && styles.screenshotDotActive
              )}
              onClick={() => scrollTo(index)}
            >
              {shot.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function HomepageFeaturesSection() {
  const features = [
    {
      icon: Server,
      title: 'Open Source & Self-Hosted',
      description:
        'Take full control of your test management with our open-source platform. Self-host on your own infrastructure for complete data ownership, security compliance, and customization freedom.',
      link: '/docs/installation',
      color: 'green',
    },
    {
      icon: Wand2,
      title: 'AI-Powered Test Generation',
      description:
        'Generate comprehensive test cases automatically from issues, requirements, or documentation using cutting-edge AI models including OpenAI GPT-4, Google Gemini, Anthropic Claude, and local Ollama models.',
      link: '/docs/user-guide/llm-integrations',
      color: 'purple',
    },
    {
      icon: ScrollText,
      title: 'QuickScript',
      description:
        'Convert manual test cases into real automation scripts for Playwright, Cypress, Selenium, pytest, Jest, and 35+ more frameworks. Export as code, or use AI with repository context for framework-idiomatic output.',
      link: '/docs/user-guide/llm-quickscript',
      color: 'pink',
    },
    {
      icon: Tags,
      title: 'Auto Tag',
      description:
        'Automatically suggest and apply tags to test cases, test runs, and sessions using AI. Keep your repository consistently organized without the manual overhead.',
      link: '/docs/user-guide/llm-auto-tag',
      color: 'yellow',
    },
    {
      icon: LinkIcon,
      title: 'Seamless Issue Integration',
      description:
        'Connect with your favorite issue tracking systems including Jira, GitHub Issues, Azure DevOps, and more. Create, link, and synchronize issues directly from your test results.',
      link: '/docs/user-guide/integrations',
      color: 'blue',
    },
    {
      icon: Shield,
      title: 'Enterprise Authentication',
      description:
        'Secure your testing environment with enterprise-grade Single Sign-On (SSO) support including SAML, OAuth, and other authentication providers for seamless user access.',
      link: '/docs/user-guide/sso',
      color: 'green',
    },
    {
      icon: Search,
      title: 'Advanced Search',
      description:
        'Powerful search capabilities with advanced filtering, full-text search, and intelligent query suggestions to quickly find test cases, results, and project artifacts across your entire testing ecosystem.',
      link: '/docs/user-guide/advanced-search',
      color: 'yellow',
    },
    {
      icon: FolderTree,
      title: 'Flexible Test Management',
      description:
        'Create and manage test cases using customizable templates, organize them in hierarchical folders, and track execution across multiple test runs with detailed reporting.',
      link: '/docs/user-guide/projects/repository',
      color: 'pink',
    },
    {
      icon: Compass,
      title: 'Exploratory Sessions',
      description:
        'Conduct structured exploratory testing sessions with real-time collaboration, session recording, and automatic test case generation from exploration findings.',
      link: '/docs/user-guide/projects/sessions',
      color: 'indigo',
    },
    {
      icon: ChartNoAxesCombined,
      title: 'Advanced Reporting',
      description:
        'Get insights with comprehensive reporting and forecasting capabilities, including execution metrics, progress tracking, and predictive analytics for better planning.',
      link: '/docs/user-guide/reporting',
      color: 'purple',
    },
    {
      icon: Globe,
      title: 'Localized Interface',
      description:
        'Multi-language support with localized user interface, making TestPlanIt accessible to teams worldwide with native language support.',
      link: '/docs/user-guide-overview',
      color: 'blue',
    },
  ];

  return (
    <section className={styles.featuresSection}>
      <div className="container">
        <div className={styles.featureGrid}>
          {features.map((feature, index) => {
            const IconComponent = feature.icon;
            return (
              <div
                key={index}
                className={styles.featureCard}
                style={{ animationDelay: `${index * 100}ms` }}
              >
                <div className={styles.featureCardOverlay} />
                <div
                  className={clsx(
                    styles.featureIconWrapper,
                    styles[`icon${feature.color}`]
                  )}
                >
                  <IconComponent size={28} className={styles.featureIcon} />
                </div>
                <div className={styles.featureContent}>
                  <h3 className={styles.featureTitle}>{feature.title}</h3>
                  <p className={styles.featureDescription}>
                    {feature.description}
                  </p>
                  <Link to={feature.link} className={styles.featureLink}>
                    Learn more <span aria-hidden="true">→</span>
                  </Link>
                </div>
                <div className={styles.featureCorner} />
              </div>
            );
          })}
          <div className={styles.featureCard}>
            <AdUnit
              adSlot="2349563487"
              adFormat="auto"
              fullWidthResponsive={true}
              style={{ minHeight: '250px' }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title={`${siteConfig.title} - ${siteConfig.tagline}`}
      description="Open-source tool for creating, managing, and executing test plans, supporting manual and automated testing."
    >
      <div className={styles.heroBackground}>
        <HomepageHeader />
        <main>
          <div className={styles.logoWrapper}>
            <Link
              className={styles.logoLink}
              href="https://testplanit.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              <img
                src="/img/logo-with-text.svg"
                alt="TestPlanIt"
                className={styles.logoLinkImage}
              />
            </Link>
          </div>
          <HomepageScreenshot />
        </main>
      </div>
      <HomepageFeaturesSection />
    </Layout>
  );
}
