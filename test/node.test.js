'use strict';

/**
 * Offline tests for n8n-nodes-skrap. Run: npm test (compiles to dist/, then node --test).
 * No network: httpRequestWithAuthentication is a stub that applies the credential's
 * `authenticate` headers, records every request and answers from a route table.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = require('../package.json');
const { Skrap } = require('../dist/nodes/Skrap/Skrap.node.js');
const { SkrapApi } = require('../dist/credentials/SkrapApi.credentials.js');
const GF = require('../dist/nodes/Skrap/GenericFunctions.js');

const API_KEY = 'sk_test_123';

/** Fake IExecuteFunctions. `params` is one object per input item. */
function makeCtx({ params, routes, continueOnFail = false }) {
	const calls = [];
	const cred = new SkrapApi();
	const ctx = {
		calls,
		getInputData: () => params.map(() => ({ json: {} })),
		getNodeParameter: (name, i, fallback) => {
			const v = params[i][name];
			if (v === undefined) {
				if (fallback !== undefined) return fallback;
				throw new Error(`Missing parameter ${name}`);
			}
			return v;
		},
		getNode: () => ({ name: 'Skrap.ai', type: 'n8n-nodes-skrap.skrap', typeVersion: 1, parameters: {} }),
		continueOnFail: () => continueOnFail,
		helpers: {
			httpRequestWithAuthentication: async function (credentialType, options) {
				assert.equal(credentialType, 'skrapApi');
				assert.equal(this, ctx, 'helper is called with the node context');
				const headers = { ...options.headers };
				for (const [k, v] of Object.entries(cred.authenticate.properties.headers)) {
					headers[k] = v.replace('={{$credentials.apiKey}}', API_KEY);
				}
				const call = { ...options, headers };
				calls.push(call);
				const key = `${options.method} ${options.url.replace(GF.API_BASE, '')}`;
				const route = routes[key];
				if (!route) throw new Error(`No stub for ${key}`);
				const answer = typeof route === 'function' ? route(call, calls) : route;
				if (answer instanceof Error) throw answer;
				return answer;
			},
		},
	};
	return ctx;
}

const run = (ctx) => new Skrap().execute.call(ctx);

const VERIFY_VALID = {
	statusCode: 200,
	body: {
		email: 'jane@example.com',
		status: 'valid',
		retryable: false,
		domainInfo: { domain: 'example.com', hasMxRecords: true },
		score: 95,
		checks: { syntax: true, mxFound: true, smtp: 'accepted', catchAll: false, disposable: false, roleAccount: false, freeProvider: false },
		riskReasons: [],
		didYouMean: null,
	},
};

test('package.json is a valid n8n community package without runtime dependencies', () => {
	assert.match(pkg.name, /^n8n-nodes-/);
	assert.ok(pkg.keywords.includes('n8n-community-node-package'));
	assert.equal(pkg.license, 'MIT');
	assert.equal(pkg.dependencies, undefined, 'no runtime dependencies');
	assert.equal(pkg.n8n.n8nNodesApiVersion, 1);
	for (const f of [...pkg.n8n.nodes, ...pkg.n8n.credentials]) {
		assert.ok(fs.existsSync(path.join(root, f)), `${f} is built`);
	}
	assert.equal(GF.CLIENT_VERSION, pkg.version, 'x-skrap-client-version follows package.json');
	assert.ok(!JSON.stringify(pkg).includes('gmail.com'), 'no personal email in the package');
});

test('credential sends the key in x-api-key and tests with GET /api/v2/account', () => {
	const c = new SkrapApi();
	assert.equal(c.name, 'skrapApi');
	assert.equal(c.properties[0].typeOptions.password, true);
	assert.deepEqual(c.authenticate.properties.headers, { 'x-api-key': '={{$credentials.apiKey}}' });
	assert.equal(c.test.request.baseURL + c.test.request.url, 'https://api.skrap.ai/api/v2/account');
});

test('description lists verification before finding and is usable as an AI tool', () => {
	const d = new Skrap().description;
	assert.equal(d.usableAsTool, true);
	assert.deepEqual(d.credentials, [{ name: 'skrapApi', required: true }]);
	const resource = d.properties.find((p) => p.name === 'resource');
	assert.deepEqual(resource.options.map((o) => o.value), ['email', 'account']);
	const emailOps = d.properties.find((p) => p.name === 'operation' && p.displayOptions.show.resource[0] === 'email');
	assert.deepEqual(emailOps.options.map((o) => o.value), ['verify', 'find']);
	assert.equal(emailOps.default, 'verify');
	assert.ok(!/scrap(e|ing)/i.test(JSON.stringify(d)), 'no scraping wording');
});

test('Verify: valid → flat item, client headers, key header, 1 request', async () => {
	const ctx = makeCtx({
		params: [{ resource: 'email', operation: 'verify', email: '  jane@example.com ' }],
		routes: { 'POST /api/v2/verify-email': VERIFY_VALID },
	});
	const [out] = await run(ctx);
	assert.equal(ctx.calls.length, 1);
	const call = ctx.calls[0];
	assert.deepEqual(call.body, { email: 'jane@example.com' });
	assert.equal(call.headers['x-api-key'], API_KEY);
	assert.equal(call.headers['x-skrap-client'], 'n8n');
	assert.equal(call.headers['x-skrap-client-version'], pkg.version);
	assert.equal(call.ignoreHttpStatusErrors, true);
	assert.deepEqual(out[0].pairedItem, { item: 0 });
	assert.deepEqual(out[0].json, {
		email: 'jane@example.com',
		status: 'valid',
		is_deliverable: true,
		retryable: false,
		score: 95,
		domain: 'example.com',
		mx_found: true,
		smtp: 'accepted',
		catch_all: false,
		disposable: false,
		role_account: false,
		free_provider: false,
		risk_reasons: '',
		did_you_mean: null,
	});
});

test('Verify: risky catch-all keeps reasons; JSON string bodies are parsed', async () => {
	const ctx = makeCtx({
		params: [{ resource: 'email', operation: 'verify', email: 'x@corp.com' }],
		routes: {
			'POST /api/v2/verify-email': {
				statusCode: 200,
				body: JSON.stringify({ email: 'x@corp.com', status: 'risky', score: 40, checks: { catchAll: true }, riskReasons: ['catch_all'] }),
			},
		},
	});
	const [out] = await run(ctx);
	assert.equal(out[0].json.status, 'risky');
	assert.equal(out[0].json.is_deliverable, false);
	assert.equal(out[0].json.catch_all, true);
	assert.equal(out[0].json.risk_reasons, 'catch_all');
	assert.equal(out[0].json.domain, 'corp.com');
});

test('Verify: empty email fails before any request', async () => {
	const ctx = makeCtx({ params: [{ resource: 'email', operation: 'verify', email: '  ' }], routes: {} });
	await assert.rejects(run(ctx), /Email is required/);
	assert.equal(ctx.calls.length, 0);
});

test('API errors become readable NodeApiErrors; continueOnFail keeps going', async () => {
	const routes = {
		'POST /api/v2/verify-email': (call) =>
			call.body.email === 'a@x.com'
				? { statusCode: 402, body: { code: 'INSUFFICIENT_CREDITS', error: 'Insufficient credits' } }
				: VERIFY_VALID,
	};
	const failing = makeCtx({ params: [{ resource: 'email', operation: 'verify', email: 'a@x.com' }], routes });
	await assert.rejects(run(failing), (err) => {
		assert.equal(err.constructor.name, 'NodeApiError');
		assert.match(err.message, /Not enough Skrap\.ai credits/);
		return true;
	});

	const tolerant = makeCtx({
		params: [
			{ resource: 'email', operation: 'verify', email: 'a@x.com' },
			{ resource: 'email', operation: 'verify', email: 'jane@example.com' },
		],
		routes,
		continueOnFail: true,
	});
	const [out] = await run(tolerant);
	assert.equal(out.length, 2);
	assert.match(out[0].json.error, /Not enough Skrap\.ai credits/);
	assert.deepEqual(out[1].pairedItem, { item: 1 });
	assert.equal(out[1].json.status, 'valid');
});

test('Unknown error codes fall back to the API message; 401 maps to the key message', async () => {
	const ctx = makeCtx({
		params: [{ resource: 'email', operation: 'verify', email: 'a@x.com' }],
		routes: { 'POST /api/v2/verify-email': { statusCode: 401, body: { code: 'INVALID_API_KEY' } } },
	});
	await assert.rejects(run(ctx), /API key was not accepted/);
	const ctx2 = makeCtx({
		params: [{ resource: 'email', operation: 'verify', email: 'a@x.com' }],
		routes: { 'POST /api/v2/verify-email': { statusCode: 503, body: { error: 'Busy, retry later' } } },
	});
	await assert.rejects(run(ctx2), /Busy, retry later/);
});

test('Find: domain from a URL, full name split, found email flattened', async () => {
	const ctx = makeCtx({
		params: [
			{
				resource: 'email',
				operation: 'find',
				firstName: '',
				lastName: '',
				domain: 'https://www.Example.com/about',
				additionalFields: { fullName: 'Jane van Doe', linkedinUrl: 'https://linkedin.com/in/jane' },
			},
		],
		routes: {
			'POST /api/v2/find-email': {
				statusCode: 200,
				body: { emails: [{ email: 'jane.vandoe@example.com', status: 'valid' }], status: 'valid', pendingRefinement: false, requestId: 'req_1' },
			},
		},
	});
	const [out] = await run(ctx);
	assert.deepEqual(ctx.calls[0].body, {
		firstName: 'Jane',
		lastName: 'van Doe',
		domain: 'example.com',
		linkedinUrl: 'https://linkedin.com/in/jane',
	});
	assert.equal(ctx.calls[0].headers['x-skrap-client'], 'n8n');
	assert.deepEqual(out[0].json, {
		found: true,
		email: 'jane.vandoe@example.com',
		status: 'valid',
		domain: 'example.com',
		company: null,
		first_name: 'Jane',
		last_name: 'van Doe',
		pending: false,
		request_id: 'req_1',
		retryable: false,
		needs_domain: false,
		domain_suggestions: '',
	});
});

test('Find: a pending answer is polled until it settles', async () => {
	let polls = 0;
	const ctx = makeCtx({
		params: [{ resource: 'email', operation: 'find', firstName: 'Li', lastName: 'Wei', domain: 'acme.com', additionalFields: {} }],
		routes: {
			'POST /api/v2/find-email': { statusCode: 200, body: { emails: [], status: 'unknown', pendingRefinement: true, requestId: 'req_9' } },
			'GET /api/v1/find-email/refinement/req_9': () => {
				polls += 1;
				return polls < 2
					? { statusCode: 200, body: { ready: false } }
					: { statusCode: 200, body: { ready: true, email: 'li.wei@acme.com', status: 'risky', retryable: false } };
			},
		},
	});
	const out = await GF.findEmail.call(ctx, 0, 1);
	assert.equal(polls, 2);
	assert.equal(out.found, true);
	assert.equal(out.email, 'li.wei@acme.com');
	assert.equal(out.status, 'risky');
	assert.equal(out.pending, false);
	assert.equal(out.request_id, 'req_9');
});

test('Find: waitSeconds 0 returns pending without polling (never charged)', async () => {
	const ctx = makeCtx({
		params: [{ resource: 'email', operation: 'find', firstName: 'Li', lastName: 'Wei', domain: 'acme.com', additionalFields: { waitSeconds: 0 } }],
		routes: { 'POST /api/v2/find-email': { statusCode: 200, body: { emails: [], pendingRefinement: true, requestId: 'req_2' } } },
	});
	const [out] = await run(ctx);
	assert.equal(ctx.calls.length, 1);
	assert.equal(out[0].json.status, 'pending');
	assert.equal(out[0].json.pending, true);
	assert.equal(out[0].json.found, false);
	assert.equal(out[0].json.request_id, 'req_2');
});

test('Find: a company name that matches no domain is "not found", not an error', async () => {
	const ctx = makeCtx({
		params: [{ resource: 'email', operation: 'find', firstName: 'Li', lastName: 'Wei', domain: '', additionalFields: { company: 'Nope Ltd' } }],
		routes: {
			'POST /api/v2/find-email': { statusCode: 400, body: { error: 'Could not resolve company', companyResolution: { companyName: 'Nope Ltd' } } },
		},
	});
	const [out] = await run(ctx);
	assert.deepEqual(ctx.calls[0].body, { firstName: 'Li', lastName: 'Wei', company: 'Nope Ltd' });
	assert.equal(out[0].json.found, false);
	assert.equal(out[0].json.status, 'not_found');
	assert.equal(out[0].json.company, 'Nope Ltd');
});

test('Find: ambiguous company name returns suggestions', async () => {
	const ctx = makeCtx({
		params: [{ resource: 'email', operation: 'find', firstName: 'Li', lastName: 'Wei', domain: '', additionalFields: { company: 'Acme' } }],
		routes: {
			'POST /api/v2/find-email': {
				statusCode: 200,
				body: { emails: [], needsCompanyConfirmation: true, suggestions: [{ domain: 'acme.com' }, 'acme.io'] },
			},
		},
	});
	const [out] = await run(ctx);
	assert.equal(out[0].json.needs_domain, true);
	assert.equal(out[0].json.domain_suggestions, 'acme.com, acme.io');
	assert.equal(out[0].json.status, 'not_found');
});

test('Find: input validation happens before any request', async () => {
	const noName = makeCtx({ params: [{ resource: 'email', operation: 'find', firstName: '', lastName: '', domain: 'a.com', additionalFields: {} }], routes: {} });
	await assert.rejects(run(noName), /first name/);
	const noCompany = makeCtx({ params: [{ resource: 'email', operation: 'find', firstName: 'A', lastName: 'B', domain: '', additionalFields: {} }], routes: {} });
	await assert.rejects(run(noCompany), /company domain/);
	assert.equal(noName.calls.length + noCompany.calls.length, 0);
});

test('Account: Get returns plan and credits (free call)', async () => {
	const ctx = makeCtx({
		params: [{ resource: 'account', operation: 'get' }],
		routes: {
			'GET /api/v2/account': { statusCode: 200, body: { id: 'u1', email: 'you@company.com', plan: 'pro', credits: 4210, team: { id: 't1', name: 'Sales' } } },
		},
	});
	const [out] = await run(ctx);
	assert.deepEqual(out[0].json, { email: 'you@company.com', plan: 'pro', credits: 4210, team_id: 't1', team_name: 'Sales' });
	assert.equal(ctx.calls[0].body, undefined);
});

test('normalizeDomain handles emails, URLs and bare domains', () => {
	assert.equal(GF.normalizeDomain('Jane@Example.COM'), 'example.com');
	assert.equal(GF.normalizeDomain('http://www.acme.io:8080/x?y'), 'acme.io');
	assert.equal(GF.normalizeDomain(' acme.com '), 'acme.com');
	assert.equal(GF.normalizeDomain(null), '');
});
