import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * Skrap.ai API key. Sent in the x-api-key header on every request; the connection test reads
 * GET /api/v2/account (free, no credits).
 */
export class SkrapApi implements ICredentialType {
	name = 'skrapApi';

	displayName = 'Skrap.ai API';

	icon: Icon = { light: 'file:skrap.svg', dark: 'file:skrap.dark.svg' };

	documentationUrl = 'https://skrap.ai/docs/n8n';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Create a key in Skrap.ai under Settings → API keys & MCP. Keys on a team spend the team’s shared credits.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'x-api-key': '={{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.skrap.ai',
			url: '/api/v2/account',
			method: 'GET',
			headers: { 'x-skrap-client': 'n8n' },
		},
	};
}
