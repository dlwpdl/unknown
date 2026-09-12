import { createContext, useContext, useState, type ReactNode } from 'react';

import { CITIES } from '@/lib/mock';
import type { City } from '@/lib/types';
import { useCommunityLocation } from '@/lib/location-provider';
import { useAuth } from '@/lib/auth';

const CommunityCityContext = createContext<{ city: City; setCity: (city: City) => void } | null>(null);

export function CommunityCityProvider({ children }: { children: ReactNode }) {
  const { cityId } = useCommunityLocation();
  const { me } = useAuth();
  const [selected, setCity] = useState<City | null>(null);
  const city = selected ?? CITIES.find((item) => item.id === cityId) ?? CITIES.find((item) => item.id === me.cityId) ?? CITIES[0];
  return <CommunityCityContext.Provider value={{ city, setCity }}>{children}</CommunityCityContext.Provider>;
}

export function useCommunityCity() {
  const value = useContext(CommunityCityContext);
  if (!value) throw new Error('CommunityCityProvider is required');
  return value;
}
