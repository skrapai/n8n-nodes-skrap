import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	JsonObject,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { findEmail, getAccount, verifyEmail } from './GenericFunctions';

/**
 * Programmatic node (not declarative): Find Email polls a second endpoint while a slow mail
 * server answers, and both email operations flatten the answer into stable field names.
 * Verification is listed before finding everywhere (product rule).
 */
export class Skrap implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Skrap.ai',
		name: 'skrap',
		icon: { light: 'file:skrap.svg', dark: 'file:skrap.dark.svg' },
		group: ['transform'],
		version: [1],
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Verify email addresses and find verified work emails with Skrap.ai',
		defaults: {
			name: 'Skrap.ai',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'skrapApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Email', value: 'email' },
					{ name: 'Account', value: 'account' },
				],
				default: 'email',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['email'] } },
				options: [
					{
						name: 'Verify',
						value: 'verify',
						action: 'Verify an email address',
						description:
							'Check whether an address can receive mail: valid, risky, invalid or unknown. 1 credit only when valid or risky.',
					},
					{
						name: 'Find',
						value: 'find',
						action: 'Find a work email',
						description:
							"Find a person's verified work email from their name and company domain or name. 1 credit only when found.",
					},
				],
				default: 'verify',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['account'] } },
				options: [
					{
						name: 'Get',
						value: 'get',
						action: 'Get account and credits',
						description: 'Email, plan and credit balance of the API key owner. Free.',
					},
				],
				default: 'get',
			},

			// Email → Verify
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'name@email.com',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['email'], operation: ['verify'] } },
				description: 'The email address to verify',
			},

			// Email → Find
			{
				displayName: 'First Name',
				name: 'firstName',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['email'], operation: ['find'] } },
				description: 'First name of the person. Or use Full Name under Additional Fields.',
			},
			{
				displayName: 'Last Name',
				name: 'lastName',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['email'], operation: ['find'] } },
			},
			{
				displayName: 'Company Domain',
				name: 'domain',
				type: 'string',
				placeholder: 'example.com',
				default: '',
				displayOptions: { show: { resource: ['email'], operation: ['find'] } },
				description:
					'Company website or domain. Gives the best results. A URL or an email address also works. Leave empty to use Company Name.',
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['email'], operation: ['find'] } },
				options: [
					{
						displayName: 'Company Location',
						name: 'location',
						type: 'string',
						default: '',
						description: 'Optional hint (city or country) that helps match a company name',
					},
					{
						displayName: 'Company Name',
						name: 'company',
						type: 'string',
						default: '',
						description: 'Use when you have no company domain',
					},
					{
						displayName: 'Full Name',
						name: 'fullName',
						type: 'string',
						default: '',
						description: 'Use when you have no separate first and last name',
					},
					{
						displayName: 'LinkedIn Profile URL',
						name: 'linkedinUrl',
						type: 'string',
						default: '',
						description: 'Optional. Helps match the right person.',
					},
					{
						displayName: 'Wait for Slow Mail Servers (Seconds)',
						name: 'waitSeconds',
						type: 'number',
						typeOptions: { minValue: 0, maxValue: 120 },
						default: 45,
						description:
							'Some mail servers answer slowly. Wait up to this long for the final answer; after that the item comes back as pending with a request ID (not charged).',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				let json: IDataObject;
				if (resource === 'email' && operation === 'verify') {
					json = await verifyEmail.call(this, i);
				} else if (resource === 'email' && operation === 'find') {
					json = await findEmail.call(this, i);
				} else if (resource === 'account' && operation === 'get') {
					json = await getAccount.call(this, i);
				} else {
					throw new NodeOperationError(this.getNode(), `Unknown operation ${resource}.${operation}`, {
						itemIndex: i,
					});
				}
				returnData.push({ json, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				// Errors from GenericFunctions already carry a readable message: keep it.
				if (error instanceof NodeOperationError) {
					throw new NodeOperationError(this.getNode(), error.message, {
						itemIndex: i,
						description: error.description ?? undefined,
					});
				}
				if (error instanceof NodeApiError) {
					throw new NodeApiError(this.getNode(), error.errorResponse ?? {}, {
						itemIndex: i,
						message: error.message,
						description: error.description ?? undefined,
						httpCode: error.httpCode ?? undefined,
					});
				}
				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
