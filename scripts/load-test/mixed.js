import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

export const successRate = new Rate('success_rate');
export const readSuccessRate = new Rate('read_success_rate');
export const writeSuccessRate = new Rate('write_success_rate');
export const readLatency = new Trend('read_latency');
export const writeLatency = new Trend('write_latency');
export const readRequests = new Counter('read_requests');
export const writeRequests = new Counter('write_requests');
export const failedRequests = new Counter('failed_requests');

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const RATE = positiveIntFromEnv('RATE', 300);
const DURATION = __ENV.DURATION || '10m';
const PRE_ALLOCATED_VUS = positiveIntFromEnv('PRE_ALLOCATED_VUS', 300);
const MAX_VUS = positiveIntFromEnv('MAX_VUS', 3000);

const READ_RATIO = ratioFromEnv('READ_RATIO', 0.7);
const BALANCE_READ_RATIO = ratioFromEnv('BALANCE_READ_RATIO', 0.75);
const HOT_READ_RATIO = ratioFromEnv('HOT_READ_RATIO', 0.8);

const START_ACCOUNT_ID = positiveIntFromEnv('START_ACCOUNT_ID', 1001);
const ACCOUNT_COUNT = positiveIntFromEnv('ACCOUNT_COUNT', 100000);
const HOT_ACCOUNT_COUNT = Math.min(positiveIntFromEnv('HOT_ACCOUNT_COUNT', 1000), ACCOUNT_COUNT);
const TRANSACTION_COUNT = positiveIntFromEnv('TRANSACTION_COUNT', 1000000);
const HOT_TRANSACTION_COUNT = Math.min(positiveIntFromEnv('HOT_TRANSACTION_COUNT', 5000), TRANSACTION_COUNT);

const MIN_AMOUNT = positiveIntFromEnv('MIN_AMOUNT', 1000);
const MAX_AMOUNT = positiveIntFromEnv('MAX_AMOUNT', 10000);
const SLEEP_MAX_SECONDS = numberFromEnv('SLEEP_MAX_SECONDS', 0.05);

export const options = {
	scenarios: {
		mixed_peak_load: {
			executor: 'constant-arrival-rate',
			rate: RATE,
			timeUnit: '1s',
			duration: DURATION,
			preAllocatedVUs: PRE_ALLOCATED_VUS,
			maxVUs: MAX_VUS,
		},
	},
	thresholds: {
		http_req_failed: ['rate<0.01'],
		success_rate: ['rate>0.99'],
		read_success_rate: ['rate>0.99'],
		write_success_rate: ['rate>0.99'],
		read_latency: ['p(95)<500'],
		write_latency: ['p(95)<2000'],
	},
};

function numberFromEnv(name, fallback) {
	const value = Number(__ENV[name]);
	return Number.isFinite(value) ? value : fallback;
}

function positiveIntFromEnv(name, fallback) {
	const value = Math.floor(numberFromEnv(name, fallback));
	return value > 0 ? value : fallback;
}

function ratioFromEnv(name, fallback) {
	return Math.min(Math.max(numberFromEnv(name, fallback), 0), 1);
}

function randomInt(min, max) {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomAccountFromPool(poolSize) {
	return START_ACCOUNT_ID + Math.floor(Math.random() * poolSize);
}

function randomReadAccount() {
	if (Math.random() < HOT_READ_RATIO) {
		return randomAccountFromPool(HOT_ACCOUNT_COUNT);
	}

	return randomAccountFromPool(ACCOUNT_COUNT);
}

function randomTransactionID() {
	const poolSize = Math.random() < HOT_READ_RATIO ? HOT_TRANSACTION_COUNT : TRANSACTION_COUNT;
	const index = Math.floor(Math.random() * poolSize);
	return `txn${String(index).padStart(22, '0')}`;
}

function buildTransactionPayload() {
	let source = randomAccountFromPool(ACCOUNT_COUNT);
	let dest = randomAccountFromPool(ACCOUNT_COUNT);

	while (dest === source) {
		dest = randomAccountFromPool(ACCOUNT_COUNT);
	}

	return JSON.stringify({
		source_account: source,
		dest_account: dest,
		amount: randomInt(MIN_AMOUNT, MAX_AMOUNT),
	});
}

function recordRead(endpoint, res) {
	const ok = check(res, {
		[`${endpoint} status is 200`]: (r) => r.status === 200,
		[`${endpoint} response time < 500ms`]: (r) => r.timings.duration < 500,
	});

	readRequests.add(1, { endpoint });
	readSuccessRate.add(ok, { endpoint });
	successRate.add(ok, { operation: 'read' });
	readLatency.add(res.timings.duration, { endpoint });

	if (!ok) {
		failedRequests.add(1, { operation: 'read', endpoint });
		console.error(`READ FAILED | endpoint=${endpoint} status=${res.status} body=${res.body}`);
	}
}

function recordWrite(res) {
	const ok = check(res, {
		'transaction status is 201 or 202': (r) => r.status === 201 || r.status === 202,
		'transaction response time < 2s': (r) => r.timings.duration < 2000,
	});

	writeRequests.add(1);
	writeSuccessRate.add(ok);
	successRate.add(ok, { operation: 'write' });
	writeLatency.add(res.timings.duration);

	if (!ok) {
		failedRequests.add(1, { operation: 'write' });
		console.error(`WRITE FAILED | status=${res.status} body=${res.body}`);
	}
}

function getBalance() {
	const accountID = randomReadAccount();
	const res = http.get(`${BASE_URL}/api/v1/accounts/${accountID}/balance`, {
		tags: { endpoint: 'balance_read' },
		timeout: '5s',
	});

	recordRead('balance', res);
}

function getTransactionStatus() {
	const transactionID = randomTransactionID();
	const res = http.get(`${BASE_URL}/api/v1/transactions/${transactionID}/status`, {
		tags: { endpoint: 'transaction_status_read' },
		timeout: '5s',
	});

	recordRead('transaction_status', res);
}

function createTransaction() {
	const res = http.post(`${BASE_URL}/api/v1/transactions`, buildTransactionPayload(), {
		headers: { 'Content-Type': 'application/json' },
		tags: { endpoint: 'transaction_write' },
		timeout: '5s',
	});

	recordWrite(res);
}

export default function () {
	if (Math.random() < READ_RATIO) {
		if (Math.random() < BALANCE_READ_RATIO) {
			getBalance();
		} else {
			getTransactionStatus();
		}
	} else {
		createTransaction();
	}

	sleep(Math.random() * SLEEP_MAX_SECONDS);
}
