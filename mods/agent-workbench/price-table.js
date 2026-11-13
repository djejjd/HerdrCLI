// 已核实的官方价（2026-11-13 抓取，USD / 1M tokens）。
export const PRICE_TABLE = {
  entries: [
    {
      model: 'gpt-6.1-sol', provider: 'openai', currency: 'USD',
      input: 2, cacheRead: 0.1, output: 10,
      cacheWriteTiers: [{ ttlMinutes: 30, rate: 2.5 }, { ttlMinutes: 720, rate: 5 }],
      mode: 'standard',
      source: 'https://developers.openai.com/api/docs/pricing',
      fetchedAt: '2026-11-13',
    },
    {
      model: 'deepseek-flash', provider: 'deepseek-official', currency: 'USD',
      ratesOffPeak: { input: 0.15, cacheRead: 0.003, cacheWrite: 0, output: 0.6 },
      ratesPeak: { input: 0.3, cacheRead: 0.006, cacheWrite: 0, output: 1.2 },
      peakWindowsUtc: [[60, 240], [360, 600]], weekdaysOnly: true,
      source: 'https://api-docs.deepseek.com/quick_start/pricing',
      fetchedAt: '2026-11-13',
    },
  ],
};
