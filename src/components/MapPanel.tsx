"use client";

import { useEffect, useRef, useState } from "react";

interface Attraction {
  name: string;
  location?: [number, number]; // [lng, lat]
  day?: number;
  order?: number;
}

interface MapPanelProps {
  attractions: Attraction[];
  onReorder?: (
    from: { day: number; index: number },
    to: { day: number; index: number },
    name: string,
  ) => void;
}

export function MapPanel({ attractions, onReorder }: MapPanelProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [map, setMap] = useState<any>(null);
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  useEffect(() => {
    if (typeof window === "undefined") return;

    let mapInstance: any = null;

    const loadMap = async () => {
      try {
        const AMapLoader = (await import("@amap/amap-jsapi-loader")).default;
        const AMap = await AMapLoader.load({
          key: process.env.NEXT_PUBLIC_AMAP_KEY || "",
          version: "2.0",
          plugins: ["AMap.Marker", "AMap.Polyline", "AMap.Geocoder"],
        });

        if (mapRef.current) {
          mapInstance = new AMap.Map(mapRef.current, {
            zoom: 12,
            center: [116.397428, 39.90923], // Default: Beijing
          });
          setMap(mapInstance);
          setMapLoaded(true);
        }
      } catch (err) {
        console.error("Failed to load map:", err);
      }
    };

    loadMap();

    return () => {
      mapInstance?.destroy();
    };
  }, []);

  useEffect(() => {
    if (!map || !mapLoaded || attractions.length === 0) return;

    // Clear existing markers
    map.clearMap();

    // Add markers for each attraction
    attractions.forEach((attr, i) => {
      if (attr.location) {
        const AMap = (window as any).AMap;
        const marker = new AMap.Marker({
          position: attr.location,
          title: attr.name,
          label: {
            content: `${i + 1}. ${attr.name}`,
            direction: "top",
          },
          draggable: !!onReorderRef.current,
        });

        if (onReorderRef.current) {
          marker.on("dragend", () => {
            onReorderRef.current!(
              { day: attr.day || 1, index: attr.order || i },
              { day: attr.day || 1, index: i },
              attr.name,
            );
          });
        }

        map.add(marker);
      }
    });

    // Auto-fit view
    if (attractions.some((a) => a.location)) {
      map.setFitView();
    }
  }, [map, mapLoaded, attractions]);

  return (
    <div className="map-panel">
      <div ref={mapRef} className="map-container" />
      {!mapLoaded && <div className="map-loading">地图加载中...</div>}
    </div>
  );
}
