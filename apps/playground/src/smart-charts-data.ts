// Built-in sample datasets for the Smart Charts tab.

export interface DatasetMeta {
	id: string;
	label: string;
	description: string;
	rows: Record<string, unknown>[];
	suggestedQuestions: string[];
}

function range(n: number): number[] {
	return Array.from({ length: n }, (_, i) => i);
}

function salesData(): Record<string, unknown>[] {
	const start = new Date('2024-01-01').getTime();
	const day = 86_400_000;
	const rows: Record<string, unknown>[] = [];
	for (const i of range(120)) {
		const t = start + i * day;
		const trend = i * 12;
		const season = 80 * Math.sin((i / 7) * 2 * Math.PI);
		const noise = (Math.random() - 0.5) * 60;
		const stepUp = i >= 60 ? 200 : 0; // change point at day 60
		rows.push({
			date: new Date(t).toISOString().slice(0, 10),
			revenue: Math.round(1000 + trend + season + stepUp + noise),
			region: ['West', 'East', 'South', 'North'][i % 4],
		});
	}
	return rows;
}

function clusteringData(): Record<string, unknown>[] {
	const rows: Record<string, unknown>[] = [];
	const clusters = [
		{ cx: 5, cy: 5, label: 'A' },
		{ cx: 12, cy: 14, label: 'B' },
		{ cx: 18, cy: 5, label: 'C' },
	];
	for (const c of clusters) {
		for (let i = 0; i < 40; i++) {
			rows.push({
				width: c.cx + (Math.random() - 0.5) * 3,
				height: c.cy + (Math.random() - 0.5) * 3,
				species: c.label,
			});
		}
	}
	return rows;
}

function anomalyData(): Record<string, unknown>[] {
	const rows: Record<string, unknown>[] = [];
	const start = new Date('2024-06-01T00:00:00Z').getTime();
	const hour = 3_600_000;
	for (let i = 0; i < 200; i++) {
		const t = start + i * hour;
		let cpu = 30 + 10 * Math.sin(i / 8) + (Math.random() - 0.5) * 6;
		if (i === 47 || i === 130 || i === 175) cpu += 50; // spikes
		rows.push({ timestamp: new Date(t).toISOString(), cpu: +cpu.toFixed(2), host: i % 3 === 0 ? 'web-01' : i % 3 === 1 ? 'web-02' : 'db-01' });
	}
	return rows;
}

function reviewsData(): Record<string, unknown>[] {
	const products = ['HeadphonesPro', 'ChargeMax', 'LampLite', 'TravelMug'];
	const reviews: Record<string, string[]> = {
		HeadphonesPro: [
			'Amazing sound quality, the bass is incredible and battery lasts forever.',
			'Loved the noise cancellation, perfect for flights and commuting.',
			'Comfortable to wear for hours, excellent build and beautiful design.',
			'Great audio fidelity but the case feels a bit cheap.',
			'Stellar performance, best headphones I have owned.',
		],
		ChargeMax: [
			'Charges my phone way too slowly, very disappointing.',
			'Cable broke after one week, terrible quality and useless now.',
			'Hot to the touch, feels unsafe and slow to charge.',
			'Awful experience, would not recommend to anyone.',
			'Not great. The unit is unreliable and the brick is heavy.',
		],
		LampLite: [
			'Pretty light, looks nice on my desk and the dim setting is great.',
			'Decent lamp for the price but the touch sensor is unreliable.',
			'Solid little product, easy to set up and stable on a desk.',
			'Bulb burned out after a month, customer support was helpful though.',
			'Good value, the warm tone is pleasant for evening reading.',
		],
		TravelMug: [
			'Keeps coffee hot for hours, fantastic insulation and feels durable.',
			'Lid leaks, very disappointing for a travel mug.',
			'Love the look and the grip is comfortable, recommended.',
			'Good mug overall but it is heavy when full.',
			'Excellent thermal performance, my favorite mug for road trips.',
		],
	};
	const rows: Record<string, unknown>[] = [];
	const start = new Date('2025-01-01').getTime();
	let i = 0;
	for (const product of products) {
		for (const review of reviews[product]) {
			const sentiment = (() => {
				const s = review.toLowerCase();
				const pos = ['amazing', 'loved', 'great', 'excellent', 'stellar', 'fantastic', 'love', 'beautiful', 'comfortable'].filter((w) => s.includes(w)).length;
				const neg = ['terrible', 'awful', 'broke', 'leaks', 'unreliable', 'disappointing', 'useless', 'slow'].filter((w) => s.includes(w)).length;
				if (pos > neg) return Math.min(5, 4 + Math.floor(Math.random() * 2));
				if (neg > pos) return Math.max(1, 1 + Math.floor(Math.random() * 2));
				return 3 + Math.floor(Math.random() * 2);
			})();
			rows.push({
				product,
				rating: sentiment,
				review_text: review,
				date: new Date(start + i * 86_400_000 * 4).toISOString().slice(0, 10),
			});
			i++;
		}
	}
	return rows;
}

export const DATASETS: DatasetMeta[] = [
	{
		id: 'sales',
		label: 'Sales time series',
		description: '120 days of revenue with weekly seasonality and a step-up partway through.',
		rows: salesData(),
		suggestedQuestions: [
			'What drove growth?',
			'When did revenue change?',
			'Is there seasonality?',
		],
	},
	{
		id: 'clusters',
		label: 'Clustering set',
		description: '120 points across three species — width vs height.',
		rows: clusteringData(),
		suggestedQuestions: [
			'Are there clusters?',
			'How does width relate to height?',
		],
	},
	{
		id: 'anomalies',
		label: 'Server metrics',
		description: '200 hours of CPU load with three injected spikes across three hosts.',
		rows: anomalyData(),
		suggestedQuestions: [
			'Show me the anomalies',
			'Which host is most stable?',
		],
	},
	{
		id: 'reviews',
		label: 'Product reviews',
		description: '20 product reviews across four products — text + rating + date.',
		rows: reviewsData(),
		suggestedQuestions: [
			'What are people complaining about?',
			'Which product has the most negative reviews?',
			'What words show up most?',
		],
	},
];
