export const BRAND_RED = '#DB0011';

export const MARKETS = [
  'Singapore',
  'Hong Kong',
  'Malaysia',
  'India',
  'Thailand'
];

export const JOURNEYS = [
  'CDD',
  'Account Servicing',
  'Payments',
  'Trade Finance'
];

export const getRandomMarket = () => MARKETS[Math.floor(Math.random() * MARKETS.length)];
export const getRandomJourney = () => JOURNEYS[Math.floor(Math.random() * JOURNEYS.length)];
