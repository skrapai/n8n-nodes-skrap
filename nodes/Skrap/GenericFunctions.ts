import type { IDataObject, IExecuteFunctions, IHttpRequestOptions, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

/** Public Skrap.ai API (https://skrap.ai/docs/api). */
export const API_BASE = 'https://api.skrap.ai';

/** Keep in step with package.json "version" (test/node.test.js checks it). */
export const CLIENT_VERSION = '0.1.0';

/** Skrap error codes → messages that tell the user what to do. */
const FRIENDLY: Record<string, string> = {
	INVALID_API_KEY:
		'Your Skrap.ai API key was not accepted. Create a new key in Skrap.ai under Settings → API keys & MCP and update the credential.',
	API_KEY_EXPIRED:
		'Your Skrap.ai API key has expired. Create a new key in Skrap.ai under Settings → API keys & MCP and update the credential.',
	IP_NOT_ALLOWED:
		'Your Skrap.ai API key has an IP allowlist that does not include this n8n server. Add its IP to the key or use a key without an allowlist.',
	INSUFFICIENT_CREDITS: 'Not enough Skrap.ai credits. Top up or upgrade at https://app.skrap.ai/billing.',
	MEMBER_CREDIT_LIMIT: 'You have used your monthly credit limit on this Skrap.ai team. Ask your team admin to raise it.',
	PLAN_REQUIRED: 'This Skrap.ai feature needs a paid plan. Upgrade at https://app.skrap.ai/billing.',
	RATE_LIMITED:
		'Too many requests for this Skrap.ai API key this minute. Add a Wait node or use smaller batches (Settings → Batching).',
	RATE_LIMIT_EXCEEDED: 'Too many Skrap.ai requests at once. Retry the node after a short wait.',
};

export type SkrapResponse = { statusCode: number; body: IDataObject };

/** One authenticated call. Never throws for HTTP status: callers decide (see raiseForStatus). */
export async function skrapRequest(
	this: IExecuteFunctions,
	method: 'GET' | 'POST',
	path: string,
	body?: IDataObject,
	timeout = 60_000,
): Promise<SkrapResponse> {
	const options: IHttpRequestOptions = {
		method,
		url: `${API_BASE}${path}`,
		headers: {
			Accept: 'application/json',
			'x-skrap-client': 'n8n',
			'x-skrap-client-version': CLIENT_VERSION,
		},
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		timeout,
	};
	if (body) options.body = body;
	const response = (await this.helpers.httpRequestWithAuthentication.call(
		this,
		'skrapApi',
		options,
	)) as { statusCode: number; body: unknown };
	let parsed: unknown = response.body;
	if (typeof parsed === 'string') {
		try {
			parsed = JSON.parse(parsed);
		} catch {
			parsed = { error: parsed };
		}
	}
	return { statusCode: response.statusCode, body: (parsed ?? {}) as IDataObject };
}

/** Throws a NodeApiError with a readable message for any 4xx/5xx answer. */
export function raiseForStatus(this: IExecuteFunctions, res: SkrapResponse, itemIndex: number): void {
	if (res.statusCode < 400) return;
	const code = (res.body.code as string) || `HTTP_${res.statusCode}`;
	const message =
		FRIENDLY[code] ||
		(res.body.error as string) ||
		(res.body.message as string) ||
		`Skrap.ai answered HTTP ${res.statusCode}.`;
	throw new NodeApiError(this.getNode(), res.body as JsonObject, {
		message,
		description: `Skrap.ai error code: ${code}`,
		httpCode: String(res.statusCode),
		itemIndex,
	});
}

export const clean = (v: unknown): string =>
	typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v).trim();

/** Domain from a URL, an email or a bare domain ("https://www.Example.com/x" → "example.com"). */
export function normalizeDomain(raw: unknown): string {
	let v = clean(raw).toLowerCase();
	if (!v) return '';
	if (v.includes('@')) v = v.split('@').pop() as string;
	v = v.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '');
	return v.split(/[/?#:\s]/)[0];
}

/** Verify answer → flat item (same field names as the Skrap Zapier and Make apps). */
export function verifyOutput(r: IDataObject): IDataObject {
	const checks = (r.checks as IDataObject) || {};
	const domainInfo = (r.domainInfo as IDataObject) || {};
	const nul = (v: unknown) => (v === undefined ? null : v);
	return {
		email: r.email,
		status: r.status,
		is_deliverable: r.status === 'valid',
		retryable: Boolean(r.retryable),
		score: nul(r.score),
		domain: (domainInfo.domain as string) || normalizeDomain(r.email),
		mx_found: nul(checks.mxFound),
		smtp: checks.smtp || null,
		catch_all: nul(checks.catchAll),
		disposable: nul(checks.disposable),
		role_account: nul(checks.roleAccount),
		free_provider: nul(checks.freeProvider),
		risk_reasons: ((r.riskReasons as string[]) || []).join(', '),
		did_you_mean: r.didYouMean || null,
	};
}

type FindInput = { firstName: string; lastName: string; domain: string | null; company: string | null };

/** Find answer (or a settled refinement) → flat item. */
export function findOutput(r: IDataObject, input: FindInput): IDataObject {
	const emails = (r.emails as IDataObject[]) || [];
	const best: IDataObject | null = emails[0] || (r.email ? { email: r.email, status: r.status } : null);
	const status = best ? (best.status as string) : (r.status as string) || 'not_found';
	const found = Boolean(best && best.email && (status === 'valid' || status === 'risky'));
	const resolution = (r.companyResolution as IDataObject) || {};
	const suggestions = ((r.suggestions as unknown[]) || [])
		.map((s) => (typeof s === 'string' ? s : s && ((s as IDataObject).domain || (s as IDataObject).website)))
		.filter(Boolean)
		.join(', ');
	return {
		found,
		email: found ? (best as IDataObject).email : null,
		status: found ? status : r.pendingRefinement ? 'pending' : 'not_found',
		domain:
			(resolution.resolvedDomain as string) ||
			input.domain ||
			(found ? normalizeDomain((best as IDataObject).email) : null),
		company: (resolution.companyName as string) || input.company || null,
		first_name: input.firstName || null,
		last_name: input.lastName || null,
		pending: Boolean(r.pendingRefinement),
		request_id: r.requestId || null,
		retryable: Boolean(r.retryable),
		needs_domain: Boolean(r.needsCompanyConfirmation),
		domain_suggestions: suggestions,
	};
}

export async function verifyEmail(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const email = clean(this.getNodeParameter('email', itemIndex));
	if (!email) {
		throw new NodeOperationError(this.getNode(), 'Email is required.', { itemIndex });
	}
	const res = await skrapRequest.call(this, 'POST', '/api/v2/verify-email', { email }, 90_000);
	raiseForStatus.call(this, res, itemIndex);
	return verifyOutput(res.body);
}

/**
 * POST /api/v2/find-email, then (when the mail server answers slowly and the user allows it)
 * poll the refinement endpoint for up to `waitSeconds`. A still-pending find comes back as
 * status "pending" with its request_id; it is not charged until it settles valid or risky.
 */
export async function findEmail(
	this: IExecuteFunctions,
	itemIndex: number,
	pollIntervalMs = 3000,
): Promise<IDataObject> {
	let firstName = clean(this.getNodeParameter('firstName', itemIndex, ''));
	let lastName = clean(this.getNodeParameter('lastName', itemIndex, ''));
	const domain = normalizeDomain(this.getNodeParameter('domain', itemIndex, ''));
	const options = this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject;
	const fullName = clean(options.fullName);
	const company = clean(options.company);
	const waitSeconds = Math.max(0, Math.min(120, Number(options.waitSeconds ?? 45)));

	if (!firstName && !lastName && !fullName) {
		throw new NodeOperationError(this.getNode(), 'Give a first name (and last name) or a full name.', {
			itemIndex,
		});
	}
	if (!domain && !company) {
		throw new NodeOperationError(
			this.getNode(),
			'Give the company domain (best) or a company name under Additional Fields.',
			{ itemIndex },
		);
	}
	if (!firstName && fullName) {
		const parts = fullName.split(/\s+/);
		firstName = parts.shift() as string;
		lastName = lastName || parts.join(' ');
	}
	const body: IDataObject = { firstName, lastName };
	if (domain) body.domain = domain;
	if (company) body.company = company;
	if (clean(options.linkedinUrl)) body.linkedinUrl = clean(options.linkedinUrl);
	if (clean(options.location)) body.location = clean(options.location);
	const input: FindInput = { firstName, lastName, domain: domain || null, company: company || null };

	const started = Date.now();
	const res = await skrapRequest.call(this, 'POST', '/api/v2/find-email', body, 90_000);
	// A company name that matches no domain: a normal "not found", not a failed item.
	if (res.statusCode === 400 && res.body.companyResolution) {
		return findOutput({ emails: [], companyResolution: res.body.companyResolution }, input);
	}
	raiseForStatus.call(this, res, itemIndex);
	let r = res.body;

	while (r.pendingRefinement && r.requestId && Date.now() - started < waitSeconds * 1000) {
		await sleep(pollIntervalMs);
		const poll = await skrapRequest
			.call(this, 'GET', `/api/v1/find-email/refinement/${encodeURIComponent(String(r.requestId))}`, undefined, 10_000)
			.catch(() => null);
		if (poll && poll.statusCode === 200 && poll.body.ready) {
			r = {
				...poll.body,
				requestId: r.requestId,
				companyResolution: r.companyResolution,
				pendingRefinement: false,
			};
		}
	}
	return findOutput(r, input);
}

export async function getAccount(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const res = await skrapRequest.call(this, 'GET', '/api/v2/account');
	raiseForStatus.call(this, res, itemIndex);
	const b = res.body;
	const team = (b.team as IDataObject) || null;
	return {
		email: b.email,
		plan: b.plan,
		credits: b.credits,
		team_id: team ? team.id : null,
		team_name: team ? team.name : null,
	};
}
