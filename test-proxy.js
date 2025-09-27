const { SocksProxyAgent } = require('socks-proxy-agent');

async function testProxy(proxyUrl, proxyName) {
	console.log(`🧪 Testing ${proxyName}...`);
	console.log(`🔗 Proxy: ${proxyUrl}`);

	const agent = new SocksProxyAgent(proxyUrl, {
		timeout: 10000, // 10 second timeout
	});

	const https = require('https');

	return new Promise((resolve, reject) => {
		const startTime = Date.now();

		const req = https.request(
			{
				hostname: 'api.telegram.org',
				port: 443,
				path: '/',
				method: 'GET',
				agent: agent,
			},
			(res) => {
				const responseTime = Date.now() - startTime;
				console.log(`✅ ${proxyName} test successful!`);
				console.log(`   Status: ${res.statusCode}`);
				console.log(`   Response time: ${responseTime}ms`);

				let data = '';
				res.on('data', (chunk) => {
					data += chunk;
				});

				res.on('end', () => {
					if (res.statusCode === 200) {
						console.log(`   📡 Connected to Telegram API successfully`);
					}
					resolve({
						proxy: proxyName,
						status: res.statusCode,
						responseTime: responseTime,
						headers: res.headers,
					});
				});
			}
		);

		req.setTimeout(10000, () => {
			console.log(`❌ ${proxyName} timed out after 10 seconds`);
			reject(new Error(`Timeout - ${proxyName} is not responding`));
		});

		req.on('error', (error) => {
			const responseTime = Date.now() - startTime;
			console.error(`❌ ${proxyName} failed after ${responseTime}ms:`);
			console.error(`   Error: ${error.message}`);
			console.error(`   Code: ${error.code}`);
			reject(error);
		});

		req.end();
	});
}

// Test multiple proxy configurations
async function testAllProxies() {
	const proxies = [
		{
			name: 'New Proxy (web.safaiian.ir)',
			url: 'socks5://web.safaiian.ir:3443',
		},
		{
			name: 'Old Proxy (mci.parsa-learning.ir)',
			url: 'socks5://mci.parsa-learning.ir:3443',
		},
	];

	console.log('🚀 Starting proxy tests...\n');

	for (const proxy of proxies) {
		try {
			await testProxy(proxy.url, proxy.name);
			console.log('---');
		} catch (error) {
			console.log('---');
			continue; // Test next proxy even if this one fails
		}
	}

	console.log('📊 Testing complete!');
}

// Also test direct connection (without proxy)
async function testDirectConnection() {
	console.log('🧪 Testing direct connection (without proxy)...');

	const https = require('https');
	const startTime = Date.now();

	return new Promise((resolve, reject) => {
		const req = https.request(
			{
				hostname: 'api.telegram.org',
				port: 443,
				path: '/',
				method: 'GET',
			},
			(res) => {
				const responseTime = Date.now() - startTime;
				console.log(`📡 Direct connection result:`);
				console.log(`   Status: ${res.statusCode}`);
				console.log(`   Response time: ${responseTime}ms`);
				resolve(res.statusCode);
			}
		);

		req.setTimeout(10000, () => {
			console.log('❌ Direct connection timed out - Telegram API is blocked');
			reject(new Error('Telegram API blocked in your region'));
		});

		req.on('error', (error) => {
			console.error('❌ Direct connection failed:');
			console.error(`   Error: ${error.message}`);
			console.error(`   This confirms Telegram API is blocked`);
			reject(error);
		});

		req.end();
	});
}

// Run all tests
async function runAllTests() {
	try {
		// First test direct connection
		await testDirectConnection();
		console.log('---');

		// Then test proxies
		await testAllProxies();
	} catch (error) {
		console.log('\n💡 Recommendations:');
		console.log('1. If all proxies fail → Use your German server');
		console.log('2. If direct connection fails but proxies work → Use proxies');
		console.log('3. If everything fails → Deploy to German server (easiest)');
	}
}

// Run the tests
runAllTests().catch(console.error);
