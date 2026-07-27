<template>
    <div class='card h-100 border-0 bg-transparent'>
        <div class='card-body'>
            <div class='card mb-3'>
                <div class='card-body'>
                    <h3 class='card-title mb-2'>
                        Lightning Monitor
                    </h3>
                    <p class='text-secondary small mb-0'>
                        Live strikes from Blitzortung.org within a radius of your chosen
                        center point. Data by Blitzortung.org &amp; contributors —
                        entertainment use only, not for protection of life or property.
                    </p>
                </div>
            </div>

            <div class='card mb-3'>
                <div class='card-body'>
                    <h4 class='card-title mb-3'>
                        Center Point
                    </h4>

                    <div class='row g-2 mb-2'>
                        <div class='col-6'>
                            <label class='form-label small'>Latitude</label>
                            <input
                                v-model.number='state.settings.centerLat'
                                type='number'
                                step='0.000001'
                                class='form-control'
                                placeholder='36.036182'
                                :disabled='state.running'
                                @change='onSettingsChange'
                            >
                        </div>
                        <div class='col-6'>
                            <label class='form-label small'>Longitude</label>
                            <input
                                v-model.number='state.settings.centerLon'
                                type='number'
                                step='0.000001'
                                class='form-control'
                                placeholder='-78.486770'
                                :disabled='state.running'
                                @change='onSettingsChange'
                            >
                        </div>
                    </div>

                    <button
                        class='btn btn-secondary w-100'
                        :disabled='state.running'
                        @click='onPick'
                    >
                        {{ state.picking ? 'Click the map… (tap here to cancel)' : 'Pick Center on Map' }}
                    </button>
                </div>
            </div>

            <div class='card mb-3'>
                <div class='card-body'>
                    <h4 class='card-title mb-3'>
                        Filter
                    </h4>

                    <label class='form-label small'>
                        Radius: {{ state.settings.radiusMi }} mi
                    </label>
                    <input
                        v-model.number='state.settings.radiusMi'
                        type='range'
                        min='5'
                        max='200'
                        step='5'
                        class='form-range mb-3'
                        :disabled='state.running'
                        @change='onSettingsChange'
                    >

                    <label class='form-label small'>Strike lifetime (seconds)</label>
                    <input
                        v-model.number='state.settings.staleSec'
                        type='number'
                        min='30'
                        max='1200'
                        step='30'
                        class='form-control'
                        :disabled='state.running'
                        @change='onSettingsChange'
                    >
                </div>
            </div>

            <div class='card mb-3'>
                <div class='card-body'>
                    <h4 class='card-title mb-3'>
                        OpenWeather
                    </h4>

                    <label class='form-check mb-2'>
                        <input
                            v-model='state.settings.openWeatherEnabled'
                            class='form-check-input'
                            type='checkbox'
                            :disabled='state.running'
                            @change='onSettingsChange'
                        >
                        <span class='form-check-label'>
                            Enable OpenWeather poll (every 2 min)
                        </span>
                    </label>

                    <div class='mb-2'>
                        <label class='form-label small'>API key</label>
                        <input
                            v-model='state.settings.openWeatherApiKey'
                            class='form-control'
                            type='password'
                            autocomplete='off'
                            placeholder='OpenWeather API key'
                            :disabled='state.running'
                            @change='onSettingsChange'
                        >
                    </div>

                    <p class='text-secondary small mb-0'>
                        OpenWeather radius is capped at 50 km; Blitzortung uses the full radius above.
                        ~720 calls/day if left on 24 hours (under the free 1,000/day quota).
                    </p>

                    <div
                        v-if='state.openWeatherError'
                        class='text-danger small mt-2'
                        v-text='state.openWeatherError'
                    />
                    <div
                        v-else-if='state.running && state.settings.openWeatherEnabled && state.openWeatherLastPoll'
                        class='text-secondary small mt-2'
                    >
                        Last OpenWeather poll:
                        {{ new Date(state.openWeatherLastPoll).toLocaleTimeString() }}
                    </div>
                </div>
            </div>

            <div class='card mb-3'>
                <div class='card-body'>
                    <h4 class='card-title mb-3'>
                        CoT Markers
                    </h4>

                    <label class='form-check mb-2'>
                        <input
                            v-model='state.settings.publishCot'
                            class='form-check-input'
                            type='checkbox'
                            :disabled='state.running'
                            @change='onSettingsChange'
                        >
                        <span class='form-check-label'>
                            Publish CoT markers to map
                        </span>
                    </label>

                    <template v-if='state.settings.publishCot'>
                        <div class='mb-2'>
                            <label class='form-label small'>Destination</label>
                            <div class='d-flex gap-3'>
                                <label class='form-check'>
                                    <input
                                        v-model='state.settings.cotDestination'
                                        class='form-check-input'
                                        type='radio'
                                        value='local'
                                        :disabled='state.running'
                                        @change='onSettingsChange'
                                    >
                                    <span class='form-check-label'>Local</span>
                                </label>
                                <label class='form-check'>
                                    <input
                                        v-model='state.settings.cotDestination'
                                        class='form-check-input'
                                        type='radio'
                                        value='mission'
                                        :disabled='state.running'
                                        @change='onCotDestinationChange'
                                    >
                                    <span class='form-check-label'>Mission</span>
                                </label>
                            </div>
                        </div>

                        <div v-if='state.settings.cotDestination === "mission"'>
                            <label class='form-label small'>DataSync mission</label>
                            <select
                                :value='state.settings.missionGuid ?? ""'
                                class='form-select'
                                :disabled='state.running || !missions.length'
                                @change='onMissionSelect'
                            >
                                <option value=''>
                                    {{ missions.length ? 'Select a mission…' : 'No subscribed missions' }}
                                </option>
                                <option
                                    v-for='m in missions'
                                    :key='m.guid'
                                    :value='m.guid'
                                    v-text='m.name'
                                />
                            </select>
                            <p class='text-secondary small mt-2 mb-0'>
                                Subscribe to a mission on the map first (Menu → Missions → Subscribe).
                                CoT markers use the strike lifetime above as their stale time.
                            </p>
                        </div>
                    </template>
                </div>
            </div>

            <div class='card mb-3'>
                <div class='card-body'>
                    <button
                        v-if='!state.running'
                        class='btn btn-primary w-100'
                        :disabled='!canStart'
                        @click='start()'
                    >
                        Start Monitoring
                    </button>
                    <button
                        v-else
                        class='btn btn-danger w-100'
                        @click='stop()'
                    >
                        Stop Monitoring
                    </button>

                    <button
                        v-if='state.running && !isMobile'
                        class='btn btn-secondary w-100 mt-2'
                        @click='openHistoryPane()'
                    >
                        Show History
                    </button>

                    <div
                        v-if='state.error'
                        class='text-danger small mt-2'
                        v-text='state.error'
                    />

                    <div
                        v-if='missionGateHint'
                        class='text-warning small mt-2'
                        v-text='missionGateHint'
                    />

                    <div class='d-flex justify-content-between mt-3 small'>
                        <span>
                            Feed:
                            <span
                                :class='state.connected ? "text-success" : "text-secondary"'
                                v-text='state.connected ? "Connected" : (state.running ? "Connecting…" : "Stopped")'
                            />
                        </span>
                        <span
                            class='text-secondary'
                            v-text='state.server.replace("wss://", "")'
                        />
                    </div>
                    <div class='d-flex justify-content-between mt-1 small'>
                        <span>Active strikes: {{ state.strikes.length }}</span>
                        <span>Total this session: {{ state.totalSeen }}</span>
                    </div>
                </div>
            </div>

            <div
                v-if='isMobile && state.running'
                class='card'
            >
                <div class='card-body p-0'>
                    <h4 class='card-title mb-0 px-3 pt-3 pb-1'>
                        Strike History
                    </h4>
                    <div class='mobile-history'>
                        <StrikeHistoryPane />
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useAppStore } from '@/stores/app.ts';
import StrikeHistoryPane from './StrikeHistoryPane.vue';
import {
    state,
    start,
    stop,
    beginPick,
    cancelPick,
    saveSettings,
    drawFence,
    openHistoryPane
} from './lightning.ts';
import {
    hasSubscribedMission,
    listSubscribedMissions,
    type SubscribedMission
} from './missions.ts';

const appStore = useAppStore();
const isMobile = computed(() => appStore.isMobileDetected);
const missions = ref<SubscribedMission[]>([]);

const missionOk = computed(() => {
    if (!state.settings.publishCot) return true;
    if (state.settings.cotDestination !== 'mission') return true;
    return hasSubscribedMission(state.settings.missionGuid);
});

const canStart = computed(() => {
    if (state.settings.centerLat === null || state.settings.centerLon === null) {
        return false;
    }
    return missionOk.value;
});

const missionGateHint = computed(() => {
    if (state.running || !state.settings.publishCot) return '';
    if (state.settings.cotDestination !== 'mission') return '';
    if (missionOk.value) return '';
    return 'Select a subscribed DataSync mission before starting.';
});

function refreshMissions(): void {
    missions.value = listSubscribedMissions();
    const guid = state.settings.missionGuid;
    if (guid && !hasSubscribedMission(guid)) {
        state.settings.missionGuid = null;
        saveSettings();
    }
}

function onPick(): void {
    if (state.picking) {
        cancelPick();
    } else {
        beginPick();
    }
}

function onSettingsChange(): void {
    saveSettings();
    drawFence();
}

function onCotDestinationChange(): void {
    refreshMissions();
    onSettingsChange();
}

function onMissionSelect(evt: Event): void {
    const value = (evt.target as HTMLSelectElement).value;
    state.settings.missionGuid = value || null;
    onSettingsChange();
}

onMounted(() => {
    refreshMissions();
});
</script>

<style scoped>
.mobile-history {
    max-height: 50vh;
    overflow: hidden;
}
</style>
