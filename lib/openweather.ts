/**
 * OpenWeather Historical Lightning Data API poller (every 2 minutes).
 * https://openweathermap.org/api/lightning
 */
import { ingestStrike, state } from './lightning.ts';

const OWM_URL = 'https://api.openweathermap.org/lightning/1.0/data';
const POLL_MS = 120_000;
const WINDOW_MS = 3 * 60 * 1000;
const MAX_RADIUS_KM = 50;

type OwmLightning = {
    id?: string;
    datetime?: string;
    lat?: number;
    lon?: number;
};

type OwmResponse = {
    lightnings?: OwmLightning[];
};

let pollTimer: ReturnType<typeof setInterval> | null = null;
let polling = false;

function clampRadiusKm(): number {
    const km = state.settings.radiusMi * 1.609344;
    return Math.min(Math.max(km, 0.1), MAX_RADIUS_KM);
}

function toIsoZ(ms: number): string {
    return new Date(ms).toISOString();
}

async function pollOnce(): Promise<void> {
    if (!state.running || !state.settings.openWeatherEnabled) return;

    const key = state.settings.openWeatherApiKey.trim();
    const { centerLat, centerLon } = state.settings;
    if (!key || centerLat === null || centerLon === null) return;

    const end = Date.now();
    const start = end - WINDOW_MS;
    const radius = clampRadiusKm();

    const url = new URL(OWM_URL);
    url.searchParams.set('lat', String(centerLat));
    url.searchParams.set('lon', String(centerLon));
    url.searchParams.set('radius', String(radius));
    url.searchParams.set('start_date', toIsoZ(start));
    url.searchParams.set('end_date', toIsoZ(end));
    url.searchParams.set('apikey', key);

    try {
        const res = await fetch(url.toString());
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            state.openWeatherError = `OpenWeather HTTP ${res.status}${body ? `: ${body.slice(0, 120)}` : ''}`;
            console.warn('Lightning Plugin: OpenWeather poll failed', res.status, body);
            return;
        }

        const data = await res.json() as OwmResponse;
        state.openWeatherError = '';
        state.openWeatherLastPoll = Date.now();

        for (const hit of data.lightnings ?? []) {
            if (typeof hit.lat !== 'number' || typeof hit.lon !== 'number') continue;
            const timeMs = hit.datetime ? Date.parse(hit.datetime) : Date.now();
            if (!Number.isFinite(timeMs)) continue;
            const id = hit.id ? `ow-${hit.id}` : undefined;
            ingestStrike(hit.lat, hit.lon, timeMs, 'openweather', id);
        }
    } catch (err) {
        state.openWeatherError = err instanceof Error ? err.message : String(err);
        console.warn('Lightning Plugin: OpenWeather poll error', err);
    }
}

/** Start polling when monitoring is on and OWM is enabled with a key. */
export function startOpenWeatherPoll(): void {
    stopOpenWeatherPoll();

    if (
        !state.running
        || !state.settings.openWeatherEnabled
        || !state.settings.openWeatherApiKey.trim()
    ) {
        return;
    }

    polling = true;
    void pollOnce();
    pollTimer = setInterval(() => {
        if (!polling || !state.running) return;
        void pollOnce();
    }, POLL_MS);
}

export function stopOpenWeatherPoll(): void {
    polling = false;
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}
