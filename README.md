# n8n-nodes-skrap

This is an n8n community node. It lets you use [Skrap.ai](https://skrap.ai) in your n8n workflows.

Skrap.ai verifies email addresses (valid, risky, invalid or unknown) and finds verified work emails from a person's name and company. You are charged only for useful results: 1 credit per valid or risky verification and per email found. Invalid, unknown and not-found results are free.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

Built and maintained by the Skrap.ai team (Infralyon Technology). Questions and bugs: [GitHub issues](https://github.com/skrapai/n8n-nodes-skrap/issues) or support@skrap.ai.

[Installation](#installation) · [Operations](#operations) · [Credentials](#credentials) · [Compatibility](#compatibility) · [Usage](#usage) · [Resources](#resources) · [Version history](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation. The package name is `n8n-nodes-skrap`.

On self-hosted n8n: **Settings → Community nodes → Install**, enter `n8n-nodes-skrap`, confirm, then search for **Skrap.ai** in the nodes panel.

## Operations

| Resource | Operation | What it does | Credits |
|---|---|---|---|
| Email | **Verify** | Checks whether an address can receive mail: `valid`, `risky`, `invalid` or `unknown`, with the checks behind it (mail server, mailbox, catch-all, disposable, role account, free provider, typo hint). | 1 when valid or risky |
| Email | **Find** | Finds a person's work email from their first and last name (or full name) and the company domain (or company name), and verifies it. | 1 when found |
| Account | **Get** | Email, plan and credit balance of the key owner. | Free |

The node can also be used as a tool by n8n AI agents.

### Output fields

**Verify:** `email`, `status`, `is_deliverable`, `retryable`, `score`, `domain`, `mx_found`, `smtp`, `catch_all`, `disposable`, `role_account`, `free_provider`, `risk_reasons`, `did_you_mean`.

**Find:** `found`, `email`, `status` (`valid`, `risky`, `not_found` or `pending`), `domain`, `company`, `first_name`, `last_name`, `pending`, `request_id`, `retryable`, `needs_domain`, `domain_suggestions`.

## Credentials

1. Sign up at [skrap.ai](https://skrap.ai) and choose a paid plan or buy a credit pack (API keys are not on the Free plan).
2. In Skrap.ai open **Settings → API keys & MCP** and create a key.
3. In n8n create a **Skrap.ai API** credential and paste the key. n8n tests it with a free account call.

Keys on a Skrap.ai team spend the team's shared credits. If the key has an IP allowlist, add your n8n server's IP to it.

## Compatibility

Built with `@n8n/node-cli` 0.56 and `n8n-workflow` 2.x (n8n 1.x and 2.x with community-node API version 1). No runtime dependencies.

## Usage

- **Verify before you send.** Put Verify in front of your email or CRM step and add an IF node on `status` (keep `valid`, or `valid` and `risky`).
- **Find only what is missing.** Route items without an email (or with an invalid one) to Find.
- **Slow mail servers.** Find waits up to 45 seconds for slow mail servers by default (Additional Fields → Wait for Slow Mail Servers, 0–120). After that the item comes back with `status: pending` and a `request_id`; it is not charged until it settles.
- **Rate limits.** Professional keys allow 120 requests a minute, Enterprise 600. For large lists, use the node's Batching setting or Skrap.ai's bulk jobs (see the API docs).
- `retryable: true` on an `unknown` means the cause was temporary: run the item again later.

## Resources

- [Skrap.ai for n8n: setup guide](https://skrap.ai/docs/n8n)
- [Skrap.ai API reference](https://skrap.ai/docs/api)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## Version history

- **0.1.0**: Email → Verify, Email → Find (with slow-server wait), Account → Get.

## Development

```bash
npm install
npm test        # compiles and runs the offline tests (no network, stubbed HTTP layer)
npm run lint    # n8n community node lint
npm run build
```

### Releasing

Releases are published to npm by GitHub Actions with npm provenance (`.github/workflows/publish.yml`), never from a local machine.

- First release (0.1.0): push the tag `0.1.0` (`git tag 0.1.0 && git push origin 0.1.0`); no version bump.
- Later releases: `npm run release` bumps the version (the `version` script copies it into `CLIENT_VERSION`), commits, tags and pushes; the tag runs the publish workflow.
- The workflow fails if the tag does not equal the `package.json` version.
