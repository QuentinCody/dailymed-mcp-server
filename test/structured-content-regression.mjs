#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, '..');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assertContains(filePath, haystack, needle, testName) {
  totalTests++;
  if (haystack.includes(needle)) {
    console.log(`${GREEN}✓${RESET} ${testName}`);
    passedTests++;
  } else {
    console.log(`${RED}✗${RESET} ${testName}`);
    console.log(`  Missing: ${needle}`);
    console.log(`  File: ${filePath}`);
    failedTests++;
  }
}

function readFile(relPath) {
  const absPath = path.resolve(SERVER_ROOT, relPath);
  return fs.readFileSync(absPath, 'utf8');
}

console.log(`${BLUE}🧪 DailyMed Structured Content Regression Tests${RESET}`);

// Code Mode tool registration (search + execute + query + schema)
const toolExpectations = [
  {
    path: 'src/tools/code-mode.ts',
    required: ['createSearchTool', 'createExecuteTool', 'dailymedCatalog'],
  },
  {
    path: 'src/tools/query-data.ts',
    required: ['createQueryDataHandler', 'dailymed_query_data'],
  },
  {
    path: 'src/tools/get-schema.ts',
    required: ['createGetSchemaHandler', 'dailymed_get_schema'],
  },
];

for (const { path: filePath, required } of toolExpectations) {
  const content = readFile(filePath);
  for (const token of required) {
    assertContains(filePath, content, token, `${filePath} includes ${token}`);
  }
}

const indexContent = readFile('src/index.ts');
assertContains('src/index.ts', indexContent, 'DailymedDataDO', 'index.ts exports DailymedDataDO');
assertContains('src/index.ts', indexContent, 'StatelessMcpWorker', 'index.ts uses StatelessMcpWorker');
assertContains('src/index.ts', indexContent, 'registerCodeMode', 'index.ts registers Code Mode tools');

// Catalog must include the overlap-rule sentence from §3.1 of the plan
const catalogContent = readFile('src/spec/catalog.ts');
assertContains(
  'src/spec/catalog.ts',
  catalogContent,
  'Use openfda for quick label-metadata search',
  'catalog description includes the openFDA vs DailyMed overlap sentence',
);
assertContains(
  'src/spec/catalog.ts',
  catalogContent,
  'full SPL XML, boxed-warning verbatim text, historical label versions',
  'catalog description references the differentiators vs openFDA',
);

// Base URL sanity check
const adapterContent = readFile('src/lib/http.ts') + readFile('src/lib/read.ts');
assertContains(
  'src/lib/http.ts',
  adapterContent,
  'https://dailymed.nlm.nih.gov/dailymed',
  'public reader fixes the DailyMed origin (v2 routing is covered by executable tests)',
);

// Minimum endpoint coverage per §5.5: at least 10 endpoints
const endpointMatches = catalogContent.match(/method:\s*"(GET|POST|PUT|DELETE)"/g) || [];
totalTests++;
if (endpointMatches.length >= 10) {
  console.log(`${GREEN}✓${RESET} catalog has at least 10 endpoints (found ${endpointMatches.length})`);
  passedTests++;
} else {
  console.log(`${RED}✗${RESET} catalog has fewer than 10 endpoints (found ${endpointMatches.length})`);
  failedTests++;
}

// SPL XML endpoint is exposed (the headline differentiator)
assertContains(
  'src/spec/catalog.ts',
  catalogContent,
  '/spls/{setid}.xml',
  'catalog exposes /spls/{setid}.xml (full SPL XML)',
);

// Per-category coverage — §5.5 lists seven categories
for (const category of ['spls', 'rxcuis', 'ndcs', 'applicationnumbers', 'drugnames', 'uniis', 'classes']) {
  assertContains(
    'src/spec/catalog.ts',
    catalogContent,
    `category: "${category}"`,
    `catalog covers category "${category}"`,
  );
}

// wrangler binds the DO correctly
const wranglerContent = readFile('wrangler.jsonc');
assertContains('wrangler.jsonc', wranglerContent, '"DailymedDataDO"', 'wrangler.jsonc binds DailymedDataDO');
assertContains('wrangler.jsonc', wranglerContent, '"DAILYMED_DATA_DO"', 'wrangler.jsonc binds DAILYMED_DATA_DO');
assertContains('wrangler.jsonc', wranglerContent, '"port": 8859', 'wrangler.jsonc sets dev port 8859');
assertContains('wrangler.jsonc', wranglerContent, '"./src/ai-stub.ts"', 'wrangler.jsonc aliases the ai stub');
assertContains('wrangler.jsonc', wranglerContent, 'nodejs_compat', 'wrangler.jsonc enables nodejs_compat');

// ai-stub is the required shape
const stubContent = readFile('src/ai-stub.ts');
assertContains('src/ai-stub.ts', stubContent, 'jsonSchema', 'ai-stub.ts exports jsonSchema');

console.log(`\n${BLUE}📊 Test Results Summary${RESET}`);
console.log(`Total tests: ${totalTests}`);
console.log(`${GREEN}Passed: ${passedTests}${RESET}`);
console.log(`${RED}Failed: ${failedTests}${RESET}`);

if (failedTests > 0) {
  console.log(`\n${RED}❌ Regression tests failed.${RESET}`);
  process.exit(1);
}

console.log(`\n${GREEN}✅ DailyMed structured content regression tests passed.${RESET}`);
