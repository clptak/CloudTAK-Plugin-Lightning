<template>
    <div class='strike-history d-flex flex-column'>
        <div class='px-2 pt-2 pb-1 small text-secondary d-flex justify-content-between'>
            <span>
                Relative to
                <span
                    class='fw-bold'
                    :class='observer?.source === "gps" ? "text-success" : "text-secondary"'
                    v-text='observerLabel'
                />
            </span>
            <span v-text='`${rows.length} strike(s)`' />
        </div>

        <div class='px-2 pb-2'>
            <table class='table table-sm table-hover mb-0 small align-middle'>
                <thead class='sticky-top'>
                    <tr>
                        <th>
                            Time
                        </th>
                        <th>
                            Source
                        </th>
                        <th>
                            Coordinates
                        </th>
                        <th class='text-end'>
                            Dist / Bearing
                        </th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-if='!rows.length'>
                        <td
                            colspan='4'
                            class='text-secondary text-center py-3'
                        >
                            No active strikes in the lifetime window.
                        </td>
                    </tr>
                    <tr
                        v-for='row in rows'
                        :key='row.id'
                    >
                        <td
                            class='text-nowrap'
                            v-text='fmtStrikeTime(row.timeMs)'
                        />
                        <td
                            class='text-nowrap'
                            v-text='sourceLabel(row.source)'
                        />
                        <td
                            class='text-nowrap'
                            v-text='fmtCoords(row.lat, row.lon)'
                        />
                        <td
                            class='text-end text-nowrap'
                            v-text='`${row.distMi.toFixed(1)} mi ${row.compass}`'
                        />
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useMapStore } from '@/stores/map.ts';
import {
    state,
    getObserverLatLon,
    strikeRelative,
    fmtStrikeTime,
    type StrikeSource
} from './lightning.ts';

const mapStore = useMapStore();
const { gpsCoordinates } = storeToRefs(mapStore);

const observer = computed(() => {
    void gpsCoordinates.value;
    return getObserverLatLon();
});

const observerLabel = computed(() => {
    if (!observer.value) return '—';
    return observer.value.source === 'gps' ? 'GPS' : 'Center';
});

const rows = computed(() => {
    void gpsCoordinates.value;
    return [...state.strikes].reverse().map((s) => ({
        id: s.id,
        lat: s.lat,
        lon: s.lon,
        timeMs: s.timeMs,
        source: s.source,
        ...strikeRelative(s)
    }));
});

function sourceLabel(source: StrikeSource): string {
    return source === 'openweather' ? 'OpenWeather' : 'Blitzortung';
}

function fmtCoords(lat: number, lon: number): string {
    return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}
</script>

<style scoped>
.strike-history thead th {
    background: var(--tblr-bg-surface, var(--bs-body-bg, #1e1e1e));
    z-index: 1;
}
</style>
