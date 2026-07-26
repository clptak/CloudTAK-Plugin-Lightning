/**
 * Lightning Plugin — shared state, Blitzortung websocket client,
 * and MapLibre rendering.
 *
 * Data: Blitzortung.org & contributors. Non-commercial / entertainment
 * use only — not an authoritative lightning data service.
 */
import { markRaw, reactive } from 'vue';
import type { PluginAPI } from '../../../plugin.ts';
import type { GeoJSONSource } from 'maplibre-gl';
import { useAppStore } from '../../../src/stores/app.ts';
import { useMapStore } from '../../../src/stores/map.ts';

export interface Strike {
    id: string;
    lat: number;
    lon: number;
    timeMs: number;
    distMi: number;
    compass: string;
}

export interface LightningSettings {
    centerLat: number | null;
    centerLon: number | null;
    radiusMi: number;
    staleSec: number;
}

const LS_KEY = 'plugin-lightning-settings';

const WS_SERVERS = [
    'wss://ws1.blitzortung.org',
    'wss://ws7.blitzortung.org',
    'wss://ws8.blitzortung.org'
];

const SRC_STRIKES = 'plugin-lightning-strikes';
const SRC_FENCE = 'plugin-lightning-fence';
const LYR_STRIKES = 'plugin-lightning-strikes-circle';
const LYR_FENCE = 'plugin-lightning-fence-line';
const FLOAT_UID = 'lightning-history';

export type Observer = {
    lat: number;
    lon: number;
    source: 'gps' | 'center';
};

export const state = reactive({
    running: false,
    connected: false,
    picking: false,
    server: '' as string,
    error: '' as string,
    totalSeen: 0,
    strikes: [] as Strike[],
    settings: loadSettings()
});

function loadSettings(): LightningSettings {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) return JSON.parse(raw) as LightningSettings;
    } catch (err) {
        console.warn('Lightning Plugin: failed to load settings', err);
    }
    return {
        centerLat: null,
        centerLon: null,
        radiusMi: 20,
        staleSec: 120
    };
}

export function saveSettings(): void {
    try {
        localStorage.setItem(LS_KEY, JSON.stringify(state.settings));
    } catch (err) {
        console.warn('Lightning Plugin: failed to save settings', err);
    }
}

/**
 * Blitzortung websocket frames are LZW-compressed JSON strings.
 */
function lzwDecode(input: string): string {
    const dict: Record<number, string> = {};
    const data = input.split('');
    let currChar = data[0];
    let oldPhrase = currChar;
    const out = [currChar];
    let code = 256;
    let phrase: string;

    for (let i = 1; i < data.length; i++) {
        const currCode = data[i].charCodeAt(0);
        if (currCode < 256) {
            phrase = data[i];
        } else {
            phrase = dict[currCode] ? dict[currCode] : (oldPhrase + currChar);
        }
        out.push(phrase);
        currChar = phrase.charAt(0);
        dict[code] = oldPhrase + currChar;
        code++;
        oldPhrase = phrase;
    }

    return out.join('');
}

const COMPASS = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'
];

function toRad(d: number): number {
    return d * Math.PI / 180;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

function bearingCompass(lat1: number, lon1: number, lat2: number, lon2: number): string {
    const dLon = toRad(lon2 - lon1);
    const y = Math.sin(dLon) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2))
        - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
    const brg = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    return COMPASS[Math.round(brg / 22.5) % 16];
}

/**
 * Ring of points at `radiusM` around a center — used for the fence circle.
 */
function circleRing(lat: number, lon: number, radiusM: number, steps = 72): number[][] {
    const R = 6371000;
    const ring: number[][] = [];
    const latR = toRad(lat);
    const lonR = toRad(lon);
    const d = radiusM / R;

    for (let i = 0; i <= steps; i++) {
        const brg = toRad((i / steps) * 360);
        const lat2 = Math.asin(
            Math.sin(latR) * Math.cos(d)
            + Math.cos(latR) * Math.sin(d) * Math.cos(brg)
        );
        const lon2 = lonR + Math.atan2(
            Math.sin(brg) * Math.sin(d) * Math.cos(latR),
            Math.cos(d) - Math.sin(latR) * Math.sin(lat2)
        );
        ring.push([lon2 * 180 / Math.PI, lat2 * 180 / Math.PI]);
    }

    return ring;
}

let api: PluginAPI | null = null;
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pruneTimer: ReturnType<typeof setInterval> | null = null;
let serverIdx = Math.floor(Math.random() * WS_SERVERS.length);

export function init(pluginAPI: PluginAPI): void {
    api = pluginAPI;
}

/**
 * Prefer live device GPS from CloudTAK's map store; fall back to the
 * configured filter center.
 */
export function getObserverLatLon(): Observer | null {
    if (api) {
        const gps = useMapStore(api.pinia).gpsCoordinates;
        if (gps) {
            return { lat: gps.lat, lon: gps.lng, source: 'gps' };
        }
    }

    const { centerLat, centerLon } = state.settings;
    if (centerLat !== null && centerLon !== null) {
        return { lat: centerLat, lon: centerLon, source: 'center' };
    }

    return null;
}

/** Distance / bearing from the current observer (GPS or center). */
export function strikeRelative(s: Strike): { distMi: number; compass: string } {
    const obs = getObserverLatLon();
    if (!obs) {
        return { distMi: s.distMi, compass: s.compass };
    }

    const distM = haversineMeters(obs.lat, obs.lon, s.lat, s.lon);
    return {
        distMi: distM / 1609.344,
        compass: bearingCompass(obs.lat, obs.lon, s.lat, s.lon)
    };
}

export function fmtStrikeTime(ms: number): string {
    return new Date(ms).toISOString().substring(11, 19) + 'Z';
}

export function isHistoryPaneOpen(): boolean {
    return !!api && api.float.has(FLOAT_UID);
}

/** Desktop floating history pane — no-op on mobile (table lives in the menu). */
export function openHistoryPane(): void {
    if (!api || api.float.has(FLOAT_UID)) return;
    if (useAppStore(api.pinia).isMobileDetected) return;

    // Dynamic import avoids a circular dependency with StrikeHistoryPane.vue
    void import('./StrikeHistoryPane.vue').then((mod) => {
        if (!api || !state.running || api.float.has(FLOAT_UID)) return;
        if (useAppStore(api.pinia).isMobileDetected) return;

        api.float.add({
            uid: FLOAT_UID,
            name: 'Lightning Strikes',
            component: markRaw(mod.default),
            width: 440,
            height: 380
        });
    });
}

export function closeHistoryPane(): void {
    if (!api || !api.float.has(FLOAT_UID)) return;
    api.float.remove(FLOAT_UID);
}

export function start(): void {
    if (!api) return;
    if (state.settings.centerLat === null || state.settings.centerLon === null) {
        state.error = 'Set a center point first';
        return;
    }

    state.error = '';
    state.running = true;
    saveSettings();
    ensureLayers();
    drawFence();
    connect();
    openHistoryPane();

    if (pruneTimer) clearInterval(pruneTimer);
    pruneTimer = setInterval(() => {
        pruneStrikes();
        renderStrikes();
    }, 1000);
}

export function stop(): void {
    state.running = false;
    state.connected = false;
    closeHistoryPane();

    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    if (pruneTimer) {
        clearInterval(pruneTimer);
        pruneTimer = null;
    }
    if (ws) {
        try { ws.close(); } catch { /* noop */ }
        ws = null;
    }
}

/** Full teardown for plugin disable() */
export function destroy(): void {
    stop();
    cancelPick();
    state.strikes = [];
    closeHistoryPane();

    if (api) {
        const map = api.map;
        try {
            if (map.getLayer(LYR_STRIKES)) map.removeLayer(LYR_STRIKES);
            if (map.getLayer(LYR_FENCE)) map.removeLayer(LYR_FENCE);
            if (map.getSource(SRC_STRIKES)) map.removeSource(SRC_STRIKES);
            if (map.getSource(SRC_FENCE)) map.removeSource(SRC_FENCE);
        } catch (err) {
            console.warn('Lightning Plugin: teardown error', err);
        }
    }
}

function connect(): void {
    if (!state.running) return;

    const url = WS_SERVERS[serverIdx % WS_SERVERS.length];
    state.server = url;
    serverIdx++;

    try {
        ws = new WebSocket(url);
    } catch (err) {
        console.warn('Lightning Plugin: websocket create failed', err);
        scheduleReconnect();
        return;
    }

    ws.onopen = () => {
        state.connected = true;
        state.error = '';
        // Blitzortung subscription handshake
        ws?.send(JSON.stringify({ a: 111 }));
    };

    ws.onmessage = (evt: MessageEvent) => {
        try {
            const decoded = lzwDecode(String(evt.data));
            const s = JSON.parse(decoded);
            if (typeof s.lat !== 'number' || typeof s.lon !== 'number') return;
            onStrike(s.lat, s.lon, s.time ? Math.round(s.time / 1e6) : Date.now());
        } catch {
            // Non-strike or undecodable frame — ignore
        }
    };

    ws.onclose = () => {
        state.connected = false;
        if (state.running) scheduleReconnect();
    };

    ws.onerror = () => {
        state.connected = false;
        try { ws?.close(); } catch { /* noop */ }
    };
}

function scheduleReconnect(): void {
    if (reconnectTimer || !state.running) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
    }, 3000);
}

function onStrike(lat: number, lon: number, timeMs: number): void {
    const { centerLat, centerLon, radiusMi } = state.settings;
    if (centerLat === null || centerLon === null) return;

    const distM = haversineMeters(centerLat, centerLon, lat, lon);
    if (distM > radiusMi * 1609.344) return;

    state.totalSeen++;
    state.strikes.push({
        id: `${timeMs}-${Math.round(lat * 1e4)}-${Math.round(lon * 1e4)}`,
        lat,
        lon,
        timeMs,
        distMi: distM / 1609.344,
        compass: bearingCompass(centerLat, centerLon, lat, lon)
    });

    renderStrikes();
}

function pruneStrikes(): void {
    const cutoff = Date.now() - state.settings.staleSec * 1000;
    if (state.strikes.length && state.strikes[0].timeMs < cutoff) {
        state.strikes = state.strikes.filter((s) => s.timeMs >= cutoff);
    }
}

function ensureLayers(): void {
    if (!api) return;
    const map = api.map;

    if (!map.getSource(SRC_FENCE)) {
        map.addSource(SRC_FENCE, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!map.getSource(SRC_STRIKES)) {
        map.addSource(SRC_STRIKES, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!map.getLayer(LYR_FENCE)) {
        map.addLayer({
            id: LYR_FENCE,
            type: 'line',
            source: SRC_FENCE,
            paint: {
                'line-color': '#ffd43b',
                'line-width': 1.5,
                'line-dasharray': [4, 3],
                'line-opacity': 0.8
            }
        });
    }

    if (!map.getLayer(LYR_STRIKES)) {
        map.addLayer({
            id: LYR_STRIKES,
            type: 'circle',
            source: SRC_STRIKES,
            paint: {
                // Color fades with age fraction (0 = now, 1 = stale)
                'circle-color': [
                    'interpolate', ['linear'], ['get', 'ageFrac'],
                    0.0, '#ffffff',
                    0.25, '#ffec99',
                    0.5, '#ffa94d',
                    1.0, '#c92a2a'
                ],
                'circle-radius': [
                    'interpolate', ['linear'], ['get', 'ageFrac'],
                    0.0, 7,
                    1.0, 3
                ],
                'circle-opacity': [
                    'interpolate', ['linear'], ['get', 'ageFrac'],
                    0.0, 1.0,
                    1.0, 0.4
                ],
                'circle-stroke-color': '#000000',
                'circle-stroke-width': 1
            }
        });
    }
}

export function drawFence(): void {
    if (!api) return;
    const map = api.map;
    const { centerLat, centerLon, radiusMi } = state.settings;
    const src = map.getSource(SRC_FENCE) as GeoJSONSource | undefined;
    if (!src) return;

    if (centerLat === null || centerLon === null) {
        src.setData({ type: 'FeatureCollection', features: [] });
        return;
    }

    src.setData({
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            properties: {},
            geometry: {
                type: 'LineString',
                coordinates: circleRing(centerLat, centerLon, radiusMi * 1609.344)
            }
        }]
    });
}

function renderStrikes(): void {
    if (!api) return;
    const src = api.map.getSource(SRC_STRIKES) as GeoJSONSource | undefined;
    if (!src) return;

    const now = Date.now();
    const staleMs = state.settings.staleSec * 1000;

    src.setData({
        type: 'FeatureCollection',
        features: state.strikes.map((s) => ({
            type: 'Feature',
            properties: {
                ageFrac: Math.min(1, Math.max(0, (now - s.timeMs) / staleMs))
            },
            geometry: {
                type: 'Point',
                coordinates: [s.lon, s.lat]
            }
        }))
    });
}

let pickHandler: ((e: { lngLat: { lat: number; lng: number } }) => void) | null = null;

export function beginPick(): void {
    if (!api || state.picking) return;
    const map = api.map;
    state.picking = true;
    map.getCanvas().style.cursor = 'crosshair';

    pickHandler = (e) => {
        state.settings.centerLat = Number(e.lngLat.lat.toFixed(6));
        state.settings.centerLon = Number(e.lngLat.lng.toFixed(6));
        saveSettings();
        endPick();
        ensureLayers();
        drawFence();
    };

    map.once('click', pickHandler);
}

export function cancelPick(): void {
    if (!api) return;
    if (pickHandler) {
        api.map.off('click', pickHandler);
        pickHandler = null;
    }
    endPick();
}

function endPick(): void {
    state.picking = false;
    if (api) api.map.getCanvas().style.cursor = '';
    pickHandler = null;
}

