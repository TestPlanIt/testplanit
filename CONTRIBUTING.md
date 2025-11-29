# Contributing to TestPlanIt

First off, thank you for considering contributing to TestPlanIt! It's people like you that make TestPlanIt such a great tool. We welcome contributions from everyone, regardless of their experience level.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Development Workflow](#development-workflow)
- [Style Guidelines](#style-guidelines)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Community](#community)
- [Recognition](#recognition)

## Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to [conduct@testplanit.com](mailto:conduct@testplanit.com).

## Getting Started

### Legal Requirements

Before we can accept your contributions, we need you to:

1. **Sign the Contributor License Agreement (CLA)**: This allows us to distribute your contributions under our dual license model.
   - Individual CLA: For individual contributors
   - Corporate CLA: For contributions on behalf of your employer
   - Sign at: https://testplanit.com/cla

2. **Understand the Licensing**: All contributions will be licensed under both AGPL-3.0 and our commercial license. By contributing, you agree to this dual licensing approach.

### Prerequisites

- Git knowledge and a GitHub account
- Basic understanding of test planning and management
- Familiarity with our tech stack (see Development Setup)

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues to avoid duplicates. When creating a bug report, please include:

- **Clear and descriptive title**
- **Steps to reproduce** the issue
- **Expected behavior** vs actual behavior
- **Screenshots** if applicable
- **System information** (OS, browser, version)
- **Error messages** and logs
- **Test case** that demonstrates the bug

Submit bug reports as [GitHub Issues](https://github.com/testplanit/testplanit/issues/new?template=bug_report.md).

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub Issues. When creating an enhancement suggestion, please include:

- **Use case**: What problem does this solve?
- **Proposed solution**: How should it work?
- **Alternatives considered**: What other solutions did you consider?
- **Additional context**: Mockups, examples, etc.

Submit enhancements as [GitHub Issues](https://github.com/testplanit/testplanit/issues/new?template=feature_request.md).

### Contributing Code

#### First-Time Contributors

Look for issues labeled:
- `good-first-issue` - Simple fixes to get you familiar with the codebase
- `help-wanted` - Issues where we need community help
- `documentation` - Documentation improvements

#### Types of Contributions

- **Bug fixes**: Fix reported issues
- **Features**: Implement new functionality
- **Performance**: Optimize existing code
- **Documentation**: Improve docs, add examples
- **Tests**: Add missing tests, improve coverage
- **Translations**: Help translate TestPlanIt

## Development Setup

### System Requirements

- Node.js 18+ and npm 9+
- Git 2.30+
- PostgreSQL 14+ (for backend development)
- Docker (optional, for containerized development)

### Local Development

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/testplanit.git
   cd testplanit
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Set up database**
   ```bash
   npm run db:setup
   npm run db:migrate
   npm run db:seed  # Optional: add sample data
   ```

5. **Start development server**
   ```bash
   npm run dev
   ```

6. **Run tests**
   ```bash
   npm test          # Unit tests
   npm run test:e2e  # End-to-end tests
   npm run test:all  # All tests
   ```

### Docker Development

```bash
docker-compose up -d
docker-compose exec app npm run dev
```

## Development Workflow

1. **Create a branch**
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/issue-number-description
   ```

2. **Make your changes**
   - Write code following our style guidelines
   - Add/update tests as needed
   - Update documentation if required

3. **Test your changes**
   ```bash
   npm test
   npm run lint
   npm run type-check
   ```

4. **Commit your changes** (see Commit Guidelines)

5. **Push to your fork**
   ```bash
   git push origin feature/your-feature-name
   ```

6. **Create a Pull Request**

## Style Guidelines

### Code Style

We use automated tooling to maintain consistent code style:

- **ESLint**: JavaScript/TypeScript linting
- **Prettier**: Code formatting
- **Stylelint**: CSS/SCSS linting

Run all checks:
```bash
npm run lint
npm run format
```

### Code Principles

- **Clear over clever**: Write readable, maintainable code
- **Test everything**: Aim for >80% test coverage
- **Document complex logic**: Add comments for non-obvious code
- **Follow SOLID principles**: Keep code modular and maintainable
- **Performance matters**: Consider performance implications

### File Organization

```
src/
├── components/     # Reusable UI components
├── features/       # Feature-specific code
├── hooks/          # Custom React hooks
├── services/       # API and external services
├── utils/          # Utility functions
├── types/          # TypeScript type definitions
└── tests/          # Test files
```

## Commit Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/):

### Format
```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types
- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation changes
- **style**: Code style changes (formatting, etc.)
- **refactor**: Code refactoring
- **perf**: Performance improvements
- **test**: Test additions or corrections
- **build**: Build system changes
- **ci**: CI configuration changes
- **chore**: Other changes (dependencies, etc.)

### Examples
```bash
feat(auth): add OAuth2 integration with Google

Implements Google OAuth2 for user authentication.
Includes token refresh and profile synchronization.

Closes #123
```

```bash
fix(tests): correct flaky test in plan creation

The test was failing intermittently due to timing issues.
Added proper wait conditions.

Fixes #456
```

## Pull Request Process

1. **Before submitting**:
   - Ensure all tests pass
   - Update documentation
   - Add entry to CHANGELOG.md
   - Squash commits if needed
   - Rebase on latest main branch

2. **PR Title Format**: Follow commit message format
   ```
   feat(component): add new feature
   ```

3. **PR Description Template**:
   ```markdown
   ## Description
   Brief description of changes

   ## Type of Change
   - [ ] Bug fix
   - [ ] New feature
   - [ ] Breaking change
   - [ ] Documentation update

   ## Testing
   - [ ] Unit tests pass
   - [ ] E2E tests pass
   - [ ] Manual testing completed

   ## Checklist
   - [ ] Code follows style guidelines
   - [ ] Self-review completed
   - [ ] Documentation updated
   - [ ] No new warnings
   - [ ] Tests added/updated
   - [ ] CLA signed

   ## Related Issues
   Closes #(issue number)

   ## Screenshots (if applicable)
   ```

4. **Review Process**:
   - At least one maintainer review required
   - All CI checks must pass
   - No merge conflicts
   - CLA must be signed

5. **After Merge**:
   - Delete your feature branch
   - Pull latest changes to your local main
   - Celebrate your contribution! 🎉

## Community

### Communication Channels

- **GitHub Discussions**: General discussions and Q&A
- **Discord**: Real-time chat and support - [Join here](https://discord.gg/kpfha4W2JH)
- **Twitter**: Updates and announcements - [@testplanit](https://x.com/testplanithq)

### Getting Help

- **Documentation**: https://docs.testplanit.com
- **Support**: support@testplanit.com
- **Security Issues**: security@testplanit.com (do not use public issues)

## Recognition

### Contributors

All contributors are recognized in our:
- [CONTRIBUTORS.md](CONTRIBUTORS.md) file
- Release notes
- Annual contributor report

### Rewards

Active contributors may receive:
- TestPlanIt swag (t-shirts, stickers)
- Free commercial license for personal projects
- Invitation to contributor-only events
- Recognition in our Hall of Fame

### Becoming a Maintainer

Consistent, high-quality contributors may be invited to become maintainers with:
- Write access to the repository
- Decision-making input on project direction
- Access to maintainer resources and support

## Questions?

If you have questions about contributing, please:
1. Check our [FAQ](https://testplanit.com/faq)
2. Ask in [GitHub Discussions](https://github.com/testplanit/testplanit/discussions)
3. Join our [Discord](https://discord.gg/testplanit)
4. Email us at contributors@testplanit.com

Thank you for contributing to TestPlanIt! Your efforts help make test planning better for everyone. 🚀

---

*This guide is a living document. Suggestions for improvements are welcome!*