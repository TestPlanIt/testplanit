import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import { docs, blog, pages } from './src/og-image/renderers.js';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'TestPlanIt',
  tagline: 'Test everything under the sun',
  favicon: 'img/logo.svg',

  // Set the production url of your site here
  url: 'https://docs.testplanit.com',
  trailingSlash: true,
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/',

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'testplanit', // Usually your GitHub org/user name.
  projectName: 'testplanit', // Usually your repo name.

  onBrokenLinks: 'throw',

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  headTags: [
    {
      tagName: 'script',
      attributes: {
        defer: 'defer',
        'data-domain': 'docs.testplanit.com',
        src: 'https://plausible.dermanouelian.com/js/script.file-downloads.hash.outbound-links.js',
      },
    },
    {
      tagName: 'script',
      attributes: {},
      innerHTML:
        'window.plausible = window.plausible || function() { (window.plausible.q = window.plausible.q || []).push(arguments) }',
    },
  ],

  plugins: [
    [
      '@docusaurus/plugin-client-redirects',
      {
        redirects: [
          {
            from: '/user-guide/llm-integrations',
            to: '/docs/user-guide/prompt-configurations/',
          },
        ],
      },
    ],
    [
      '@acid-info/docusaurus-og',
      {
        path: './preview-images',
        imageRenderers: {
          'docusaurus-plugin-content-docs': docs,
          'docusaurus-plugin-content-blog': blog,
          'docusaurus-plugin-content-pages': pages,
        },
      },
    ],
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          // editUrl:
          //   "https://github.com/facebook/docusaurus/tree/main/packages/create-docusaurus/templates/shared/",
        },
        blog: {
          showReadingTime: true,
          feedOptions: {
            type: ['rss', 'atom'],
            xslt: true,
          },
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          // editUrl:
          //   "https://github.com/facebook/docusaurus/tree/main/packages/create-docusaurus/templates/shared/",
          // Useful options to enforce blogging best practices
          onInlineTags: 'warn',
          onInlineAuthors: 'warn',
          onUntruncatedBlogPosts: 'warn',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    // OG images are dynamically generated per-page by @acid-info/docusaurus-og
    image: 'img/social-card.png', // fallback for pages without a generated image
    navbar: {
      title: 'TestPlanIt Docs',
      logo: {
        alt: 'TestPlanIt Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'tutorialSidebar',
          position: 'left',
          label: 'Docs',
        },
        { to: '/blog', label: 'Blog', position: 'left' },
        {
          href: 'https://github.com/testplanit/testplanit',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Introduction',
              to: '/docs/',
            },
            {
              label: 'Getting Started',
              to: '/docs/getting-started',
            },
            {
              label: 'Installation',
              to: '/docs/installation',
            },
            {
              label: 'Background Processes',
              to: '/docs/background-processes',
            },
            {
              label: 'User Guide',
              to: '/docs/user-guide-overview',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            // {
            //   label: "Stack Overflow",
            //   href: "https://stackoverflow.com/questions/tagged/docusaurus",
            // },
            {
              label: 'Discord',
              href: 'https://discord.gg/kpfha4W2JH',
            },
            {
              label: 'X',
              href: 'https://x.com/TestPlanItHQ',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'Blog',
              to: '/blog',
            },
            {
              label: 'GitHub',
              href: 'https://github.com/testplanit/testplanit',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} TestPlanIt, Inc. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
    // Algolia DocSearch Configuration
    // These are public search-only credentials, safe to commit
    algolia: {
      appId: 'TIRP24VNLH',
      apiKey: '44756cc71f4fee513570b5124c24198d',
      indexName: 'testplanit',
      contextualSearch: true,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
