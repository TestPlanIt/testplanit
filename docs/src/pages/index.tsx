import type { ReactNode } from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import {
  Sparkles,
  Wand2,
  Link as LinkIcon,
  Shield,
  Search,
  FolderTree,
  Compass,
  ChartNoAxesCombined,
  Globe,
  Settings,
} from 'lucide-react';

import styles from './index.module.css';

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '1rem',
          }}
        >
          <div
            style={{
              backgroundColor: 'white',
              width: '100%',
              padding: '5px',
              paddingLeft: '15px',
              paddingRight: '15px',
              borderRadius: '4px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <img
              src="/img/logo.svg"
              alt="TestPlanIt Logo"
              style={{ height: '50px', marginRight: '5px' }}
            />
            <Heading
              as="h1"
              className="hero__title"
              style={{ margin: 0, color: 'var(--ifm-color-primary)' }}
            >
              {siteConfig.title}
            </Heading>
          </div>
        </div>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <p
          className="hero__description"
          style={{ maxWidth: '600px', margin: '1rem auto' }}
        >
          TestPlanIt is an open-source tool for creating, managing, and
          executing test plans, supporting both manual and automated test cases.
          Easily manage test cases, record test results, and track test runs
          with flexible test case management.
        </p>
        <div className={styles.buttons}>
          <Link className="button button--secondary button--lg" to="/docs/">
            Get Started
          </Link>
          <Link
            className="button button--outline button--lg"
            style={{ marginLeft: '10px' }}
            href="https://github.com/testplanit/testplanit"
            target="_blank"
            rel="noopener noreferrer"
          >
            View on GitHub
          </Link>
        </div>
      </div>
    </header>
  );
}

function HomepageFeaturesSection() {
  const features = [
    {
      icon: Wand2,
      title: 'AI-Powered Test Generation',
      description:
        'Generate comprehensive test cases automatically from issues, requirements, or documentation using cutting-edge AI models including OpenAI GPT-4, Google Gemini, Anthropic Claude, and local Ollama models.',
      link: '/docs/user-guide/llm-integrations',
    },
    {
      icon: LinkIcon,
      title: 'Seamless Issue Integration',
      description:
        'Connect with your favorite issue tracking systems including Jira, GitHub Issues, Azure DevOps, and more. Create, link, and synchronize issues directly from your test results.',
      link: '/docs/user-guide/integrations',
    },
    {
      icon: Shield,
      title: 'Enterprise Authentication',
      description:
        'Secure your testing environment with enterprise-grade Single Sign-On (SSO) support including SAML, OAuth, and other authentication providers for seamless user access.',
      link: '/docs/user-guide/sso',
    },
    {
      icon: Search,
      title: 'Advanced Search',
      description:
        'Powerful search capabilities with advanced filtering, full-text search, and intelligent query suggestions to quickly find test cases, results, and project artifacts across your entire testing ecosystem.',
      link: '/docs/user-guide/advanced-search',
    },
    {
      icon: FolderTree,
      title: 'Flexible Test Management',
      description:
        'Create and manage test cases using customizable templates, organize them in hierarchical folders, and track execution across multiple test runs with detailed reporting.',
      link: '/docs/user-guide/projects/repository',
    },
    {
      icon: Compass,
      title: 'Exploratory Sessions',
      description:
        'Conduct structured exploratory testing sessions with real-time collaboration, session recording, and automatic test case generation from exploration findings.',
      link: '/docs/user-guide/projects/sessions',
    },
    {
      icon: ChartNoAxesCombined,
      title: 'Advanced Reporting',
      description:
        'Get insights with comprehensive reporting and forecasting capabilities, including execution metrics, progress tracking, and predictive analytics for better planning.',
      link: '/docs/user-guide/reporting',
    },
    {
      icon: Globe,
      title: 'Localized Interface',
      description:
        'Multi-language support with localized user interface, making TestPlanIt accessible to teams worldwide with native language support.',
      link: '/docs/user-guide-overview',
    },
    {
      icon: Settings,
      title: 'Flexible Database Support',
      description:
        'Use the database of your choice with support for PostgreSQL, MySQL, and other popular database systems to fit your infrastructure needs.',
      link: '/docs/installation',
    },
  ];

  return (
    <section className={styles.features} style={{ padding: '4rem 0' }}>
      <div className="container">
        <div className="row">
          <div className={clsx('col col--12')}>
            <Heading
              as="h2"
              style={{ textAlign: 'center', marginBottom: '3rem' }}
            >
              <Sparkles className={styles.sparkles} size={32} />
              Key Features
            </Heading>
            <div className={styles.featureGrid}>
              {features.map((feature, index) => {
                const IconComponent = feature.icon;
                return (
                  <div key={index} className={styles.featureCard}>
                    <div className={styles.featureHeader}>
                      <div className={styles.featureIcon}>
                        <IconComponent size={32} />
                      </div>
                      <h3 className={styles.featureTitle}>{feature.title}</h3>
                    </div>
                    <div className={styles.featureContent}>
                      <p className={styles.featureDescription}>
                        {feature.description}
                      </p>
                      <Link to={feature.link} className={styles.featureLink}>
                        Learn more →
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
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
      <HomepageHeader />
      <main>
        <HomepageFeaturesSection />
      </main>
    </Layout>
  );
}
