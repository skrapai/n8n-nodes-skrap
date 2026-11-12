'use strict';

/**
 * npm "version" lifecycle hook (dev only, not part of the published package).
 * `npm run release` bumps package.json through `npm version`, which runs this script;
 * it copies the new version into CLIENT_VERSION so the two never drift
 * (test/node.test.js checks they match). release-it then commits both files.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));
const file = path.join(root, 'nodes', 'Skrap', 'GenericFunctions.ts');
const src = fs.readFileSync(file, 'utf8');
const re = /export const CLIENT_VERSION = '[^']*';/;
if (!re.test(src)) {
	console.error('CLIENT_VERSION not found in nodes/Skrap/GenericFunctions.ts');
	process.exit(1);
}
fs.writeFileSync(file, src.replace(re, `export const CLIENT_VERSION = '${version}';`));
console.log(`CLIENT_VERSION -> ${version}`);
