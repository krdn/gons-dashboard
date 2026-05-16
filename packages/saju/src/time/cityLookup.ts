import cities from "./cities.json" with { type: "json" };

export interface CityInfo {
  name: string;
  nameKo: string;
  country: "KR" | "JP" | "CN";
  longitudeDeg: number;
  timezone: string;
}

const CITIES = cities as CityInfo[];

export function findCity(query: string): CityInfo | undefined {
  const q = query.trim().toLowerCase();
  return CITIES.find(
    c => c.name.toLowerCase() === q || c.nameKo.toLowerCase() === q,
  );
}

export function searchCities(prefix: string, limit = 20): CityInfo[] {
  const q = prefix.trim().toLowerCase();
  if (q.length === 0) return [];
  return CITIES
    .filter(c =>
      c.name.toLowerCase().startsWith(q) ||
      c.nameKo.toLowerCase().startsWith(q),
    )
    .slice(0, limit);
}
