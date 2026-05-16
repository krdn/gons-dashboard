"use client";

import { useState } from "react";
import { searchCities, type CityInfo } from "@gons/saju";

interface Props {
  value: CityInfo | null;
  onChange: (city: CityInfo | null, manualLongitude?: number) => void;
}

export function CitySelector({ value, onChange }: Props) {
  const [query, setQuery] = useState(value?.nameKo ?? "");
  const [results, setResults] = useState<CityInfo[]>([]);
  const [manualMode, setManualMode] = useState(false);
  const [manualLng, setManualLng] = useState("");

  if (manualMode) {
    return (
      <div className="flex flex-col gap-2">
        <input
          type="number"
          step="0.01"
          placeholder="경도 (예: 126.78)"
          value={manualLng}
          onChange={(e) => setManualLng(e.target.value)}
          className="border rounded px-2 py-1"
        />
        <button
          type="button"
          onClick={() => {
            const lng = parseFloat(manualLng);
            if (!isNaN(lng)) onChange(null, lng);
          }}
        >
          적용
        </button>
        <button type="button" onClick={() => setManualMode(false)}>
          도시 검색으로 돌아가기
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        type="text"
        placeholder="출생 도시 검색 (예: 부천)"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setResults(searchCities(e.target.value, 10));
        }}
        className="border rounded px-2 py-1"
      />
      {results.length > 0 && (
        <ul className="border rounded max-h-40 overflow-y-auto">
          {results.map((city) => (
            <li key={city.nameKo}>
              <button
                type="button"
                onClick={() => {
                  onChange(city);
                  setQuery(city.nameKo);
                  setResults([]);
                }}
                className="w-full text-left px-2 py-1 hover:bg-gray-100"
              >
                {city.nameKo} ({city.longitudeDeg.toFixed(2)}°E)
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={() => setManualMode(true)} className="text-sm text-blue-600">
        도시를 못 찾으셨나요? 경도 직접 입력
      </button>
    </div>
  );
}
