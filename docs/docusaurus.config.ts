import * as dotenv from 'dotenv';
dotenv.config();

import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

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
  onBrokenMarkdownLinks: 'warn',

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
    // Social card for Open Graph / Twitter previews (1200x630px recommended)
    image: 'img/social-card.png',
    navbar: {
      title: 'TestPlanIt Docs',
      logo: {
        alt: 'My Site Logo',
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
    algolia: {
      // The application ID provided by Algolia
      appId: process.env.ALGOLIA_APP_ID || 'YOUR_APP_ID', // Fallback is for placeholder only

      // Public API key: it is safe to commit it
      apiKey: process.env.ALGOLIA_API_KEY || 'YOUR_SEARCH_API_KEY', // Fallback is for placeholder only

      indexName: process.env.ALGOLIA_INDEX_NAME || 'YOUR_INDEX_NAME', // Fallback is for placeholder only

      // Optional: see DocSearch docs
      contextualSearch: true,

      // Optional: Specify domains where the navigation should occur through window.location instead navigating within the SPA
      // externalUrlRegex: 'external\\.com|domain\\.com',

      // Optional: Replace parts of the item URLs from Algolia. Useful when using the same search index for multiple deployments using a different baseUrl.
      // replaceSearchResultPathname: {
      //   from: '/docs/', // or as RegExp: /\/docs\//
      //   to: '/',
      // },

      // Optional: Algolia search parameters
      // searchParameters: {},

      // Optional: path for search page that enabled by default (`false` to disable)
      // searchPagePath: 'search',

      //... other Algolia params
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
