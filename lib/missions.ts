/**
 * Subscribed DataSync mission helpers for CoT publish.
 */
import { Preferences } from '@capacitor/preferences';
import OverlayModule from '@/base/overlay.ts';
import { db } from '@/database.ts';
import { useMapStore } from '@/stores/map.ts';

export type SubscribedMission = {
    guid: string;
    name: string;
    token: string | null;
};

type MissionOverlayLike = {
    name?: string;
    mode?: string;
    mode_id?: string | null;
    token: string | null;
};

type OverlayModuleStatic = {
    missionOverlays?: () => MissionOverlayLike[];
    loadedByMode?: (mode: string, modeId: string) => MissionOverlayLike | undefined;
};

type LegacyMapStore = {
    getOverlayByMode?: (mode: string, id: string) => MissionOverlayLike | null;
    overlays?: MissionOverlayLike[];
};

function findMissionOverlay(missionGuid: string): MissionOverlayLike | null {
    const manager = OverlayModule as unknown as OverlayModuleStatic;
    if (typeof manager.loadedByMode === 'function') {
        return manager.loadedByMode('mission', missionGuid) ?? null;
    }

    const mapStore = useMapStore() as unknown as LegacyMapStore;
    if (mapStore.getOverlayByMode) {
        return mapStore.getOverlayByMode('mission', missionGuid);
    }
    for (const overlay of mapStore.overlays ?? []) {
        if (overlay.mode === 'mission' && overlay.mode_id === missionGuid) {
            return overlay;
        }
    }
    return null;
}

/** Missions the user has subscribed to on the map (mission overlays with a mode_id). */
export function listSubscribedMissions(): SubscribedMission[] {
    const manager = OverlayModule as unknown as OverlayModuleStatic;

    let overlays: MissionOverlayLike[];
    if (typeof manager.missionOverlays === 'function') {
        overlays = manager.missionOverlays();
    } else {
        const mapStore = useMapStore() as unknown as LegacyMapStore;
        overlays = (mapStore.overlays ?? []).filter(
            (o) => o.mode === 'mission' && o.mode_id
        );
    }

    const seen = new Set<string>();
    const out: SubscribedMission[] = [];
    for (const o of overlays) {
        const guid = o.mode_id;
        if (!guid || seen.has(guid)) continue;
        seen.add(guid);
        out.push({
            guid,
            name: o.name?.trim() || guid,
            token: o.token ?? null
        });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function hasSubscribedMission(guid: string | null | undefined): boolean {
    if (!guid) return false;
    return listSubscribedMissions().some((m) => m.guid === guid);
}

/** Mission password token for MissionAuthorization when required. */
export async function resolveMissionToken(missionGuid: string): Promise<string | undefined> {
    const overlay = findMissionOverlay(missionGuid);
    if (overlay?.token) return overlay.token;

    const row = await db.subscription.get(missionGuid);
    if (row?.token) return row.token;

    return undefined;
}

export async function sessionToken(): Promise<string> {
    const { value } = await Preferences.get({ key: 'token' });
    return (value || '').trim();
}
