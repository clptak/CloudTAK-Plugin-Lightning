/**
 * Publish a lightning strike as a CoT Point — local map or DataSync mission.
 *
 * Mission flow (CloudTAK “Add to Data Sync” / ShareToMission.vue):
 *   1. Put the feature on the local map (CONNECTION) so the 2525E icon renders
 *   2. Remove + re-add with Mission origin + authored so Atlas posts into DataSync
 *
 * See also Marti PUT /Marti/api/missions/guid/{guid}/contents { uids } — Atlas
 * covers that path via sendCOT + mission dest when authored into a mission.
 */
import COT, { OriginMode } from '@/base/cot.ts';
import { useMapStore } from '@/stores/map.ts';
import type { Feature } from '@/types.ts';
import type { Pinia } from 'pinia';
import type { Strike } from './lightning.ts';
import { getPluginApi, state, strikeRelative } from './lightning.ts';
import { hasSubscribedMission } from './missions.ts';

const SIDC = '13064000001700000000';

function uuid(): string {
    return (globalThis.crypto && 'randomUUID' in globalThis.crypto)
        ? globalThis.crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        });
}

/** Strip Vue proxies before Comlink / IndexedDB structured clone. */
function toPlainFeature(feat: Feature): Feature {
    return JSON.parse(JSON.stringify(feat)) as Feature;
}

function requirePinia(): Pinia {
    const pluginApi = getPluginApi();
    if (!pluginApi) {
        throw new Error('Lightning plugin API is not initialized');
    }
    return pluginApi.pinia;
}

function buildStrikeFeature(strike: Strike): Feature {
    const id = uuid();
    const time = new Date(strike.timeMs).toISOString();
    const stale = new Date(
        strike.timeMs + state.settings.staleSec * 1000
    ).toISOString();
    const center: [number, number] = [strike.lon, strike.lat];
    const rel = strikeRelative(strike);
    const remarks = Number.isFinite(rel.distMi)
        ? `${rel.distMi.toFixed(1)} mi ${rel.compass}`
        : 'None';
    const local = new Date(strike.timeMs);
    const hhmm = `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`;

    return {
        id,
        type: 'Feature',
        path: '/',
        properties: {
            id,
            type: SIDC,
            how: 'h-g-i-g-o',
            archived: true,
            callsign: `Lightning ${hhmm}`,
            time,
            start: time,
            stale,
            center,
            'marker-opacity': 1,
            remarks,
            // Exact fields from the working FalconView CoT sample
            icon: `2525E:${SIDC}`,
            'marker-color': '#FFFFFF',
            milicon: { id: SIDC }
        },
        geometry: {
            type: 'Point',
            coordinates: center
        }
    } as unknown as Feature;
}

type CotHandle = {
    id: string;
    as_feature: () => Feature;
};

type WorkerDb = {
    add?: (
        feature: Record<string, unknown>,
        opts?: { authored?: boolean; skipSave?: boolean }
    ) => Promise<CotHandle | void>;
    get?: (id: string) => Promise<CotHandle | null | undefined>;
    remove?: (id: string) => Promise<void>;
};

type MapStoreWorker = {
    worker?: {
        db?: WorkerDb;
        conn?: {
            isOpen: Promise<boolean> | boolean;
            reconnect: (username: string) => Promise<void>;
            username?: Promise<string> | string;
        };
        profile?: {
            creator?: () => Promise<Record<string, unknown>>;
        };
        username?: Promise<string> | string;
    };
    refresh?: () => Promise<void>;
};

function mapStore(): MapStoreWorker {
    return useMapStore(requirePinia()) as unknown as MapStoreWorker;
}

async function ensureConnOpen(store: MapStoreWorker): Promise<void> {
    const conn = store.worker?.conn;
    if (!conn) throw new Error('TAK connection is not ready');

    if (await conn.isOpen) return;

    const username = await (store.worker?.username ?? conn.username ?? '');
    await conn.reconnect(String(username));
    if (!(await conn.isOpen)) {
        throw new Error('TAK connection is not open. Connect to the map and try again.');
    }
}

function applyStrikeStyle(feat: Feature): void {
    feat.properties.type = SIDC;
    feat.properties.icon = `2525E:${SIDC}`;
    feat.properties['marker-color'] = '#FFFFFF';
    feat.properties.archived = true;
    // Survives CoT wire format when type is rewritten to a-h-G
    (feat.properties as Feature['properties'] & { milicon?: { id: string } }).milicon = {
        id: SIDC
    };
}

/**
 * Place the strike on the local CloudTAK map (CONNECTION layer) so the
 * 2525E icon can render like a manually dropped marker.
 */
async function putOnMap(feat: Feature): Promise<string> {
    const store = mapStore();
    if (typeof store.worker?.db?.add !== 'function') {
        throw new Error('Map database is not ready');
    }

    const plain = toPlainFeature(feat) as unknown as Record<string, unknown>;
    const props = plain.properties as Record<string, unknown>;

    try {
        if (typeof store.worker.profile?.creator === 'function') {
            props.creator = await store.worker.profile.creator();
        }
    } catch {
        // Creator is cosmetic
    }

    // authored:false → CONNECTION layer even when a DataSync mission is active
    const created = await store.worker.db.add(plain, { authored: false });

    if (typeof store.refresh === 'function') {
        await store.refresh();
    }

    return String(created?.id || feat.id);
}

/**
 * CloudTAK ShareToMission.vue path: feature must already be on the map, then
 * remove + re-add with Mission origin + authored so Atlas posts into DataSync.
 */
async function postMapFeatureToMission(
    featureId: string,
    missionGuid: string
): Promise<void> {
    const store = mapStore();
    const db = store.worker?.db;
    if (!db?.get || !db.add || !db.remove) {
        throw new Error('Map database is not ready');
    }

    await ensureConnOpen(store);

    const existing = await db.get(featureId);
    if (!existing?.as_feature) {
        throw new Error(`Map feature ${featureId} not found after local add`);
    }

    const feat = toPlainFeature(existing.as_feature());
    await db.remove(featureId);

    // Missions should never share IDs with the connection-layer copy
    const id = uuid();
    feat.id = id;
    feat.properties = {
        ...feat.properties,
        id
    };
    applyStrikeStyle(feat);

    (feat as Feature & { origin?: { mode: OriginMode; mode_id: string } }).origin = {
        mode: OriginMode.MISSION,
        mode_id: missionGuid
    };

    await db.add(feat as unknown as Record<string, unknown>, { authored: true });

    if (typeof store.refresh === 'function') {
        await store.refresh();
    }
}

async function publishLocal(feat: Feature): Promise<void> {
    await putOnMap(feat);
}

async function publishMission(feat: Feature, missionGuid: string): Promise<void> {
    const store = mapStore();
    await ensureConnOpen(store);

    // 1) On the map first (icon renders)
    const mapId = await putOnMap(feat);

    // 2) Post that map feature into the selected DataSync mission
    await postMapFeatureToMission(mapId, missionGuid);
}

/**
 * Publish one accepted strike when CoT publishing is enabled.
 * Failures are logged; they do not stop the Blitzortung feed.
 */
export async function publishStrikeCot(strike: Strike): Promise<void> {
    if (!state.settings.publishCot) return;

    const feat = buildStrikeFeature(strike);
    await COT.style(feat);
    applyStrikeStyle(feat);

    const dest = state.settings.cotDestination;

    try {
        if (dest === 'local') {
            await publishLocal(feat);
            return;
        }

        const guid = state.settings.missionGuid;
        if (!guid || !hasSubscribedMission(guid)) {
            console.warn(
                'Lightning Plugin: mission CoT skipped — no valid subscribed mission selected'
            );
            return;
        }

        await publishMission(feat, guid);
    } catch (err) {
        console.warn('Lightning Plugin: failed to publish CoT for strike', err);
    }
}
