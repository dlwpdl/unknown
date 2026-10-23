import type { CityPlace } from './city-places';

// Curated map places. Verified webshop links and prices come from the business registry.
// Coordinates come from OpenStreetMap (Nominatim); keep the source so a bad pin can be corrected.
export type DeliveryPartner = {
  id: string; name: string; cityId: string; label: string;
  latitude: number; longitude: number; webShopUrl: string | null; promoCode?: string; discountLabel?: string;
  delivery: boolean; visited: boolean; category: 'dining' | 'cafe'; visitedSourceUrl?: string;
  photo?: CityPlace['photo'];
};

export const DELIVERY_PARTNERS: DeliveryPartner[] = [
  {
    id: 'jimoco-coquitlam',
    name: 'Jimoco Café & Pasta',
    cityId: 'vancouver',
    label: '1046A Austin Ave, Coquitlam, BC V3K 3P3',
    latitude: 49.2488234,
    longitude: -122.8640565,
    webShopUrl: null,
    discountLabel: '',
    delivery: true, visited: true, category: 'dining',
    // shortcut: The official image may change; pin a stored place image when map-photo uploads are supported.
    photo: { placeId: 'partner:jimoco-coquitlam', cityId: 'vancouver', uri: 'https://jimoco.kmon.ca/images/hero-bg.webp',
      sourceUrl: 'https://www.jimoco.ca/', title: 'Jimoco Café & Pasta · 공식 웹사이트 음식 이미지', artist: 'Jimoco Café & Pasta 공식 웹사이트',
      discoveredVia: 'Business site', license: '', licenseUrl: '', imageSha256: '0050025d96ef87d0659155beb37add78e2579f916a6359b7b844dfb9e73c6d93' },
  },
  {
    id: 'on-and-off-coquitlam',
    name: 'On & Off Kitchen + Bar',
    cityId: 'vancouver',
    label: '2662 Austin Ave, Coquitlam, BC V3K 6C4',
    latitude: 49.248846,
    longitude: -122.8169979,
    webShopUrl: null,
    discountLabel: '',
    delivery: false, visited: true, category: 'dining',
  },
];

export function deliveryPartnerPlace(cityId: string, id: string): CityPlace | undefined {
  const partner = DELIVERY_PARTNERS.find(value => value.cityId === cityId && `partner:${value.id}` === id);
  return partner ? { id, cityId, name: partner.name, category: partner.category === 'dining' ? 'food' : 'cafe',
    latitude: partner.latitude, longitude: partner.longitude, address: partner.label,
    sourceUrl: `https://www.openstreetmap.org/?mlat=${partner.latitude}&mlon=${partner.longitude}#map=18/${partner.latitude}/${partner.longitude}`,
    ...(partner.photo ? { photo: partner.photo } : {}),
    ...(partner.visited ? { glingVisited: { sourceUrl: partner.visitedSourceUrl ?? '' } } : {}) } : undefined;
}
