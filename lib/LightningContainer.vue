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
                    <button
                        v-if='!state.running'
                        class='btn btn-primary w-100'
                        :disabled='state.settings.centerLat === null || state.settings.centerLon === null'
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

                    <div
                        v-if='state.error'
                        class='text-danger small mt-2'
                        v-text='state.error'
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
                v-if='state.strikes.length'
                class='card'
            >
                <div class='card-body'>
                    <h4 class='card-title mb-2'>
                        Recent Strikes
                    </h4>
                    <div
                        v-for='s in recent'
                        :key='s.id'
                        class='d-flex justify-content-between small py-1 border-bottom border-secondary'
                    >
                        <span v-text='fmtTime(s.timeMs)' />
                        <span v-text='`${s.distMi.toFixed(1)} mi ${s.compass}`' />
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { state, start, stop, beginPick, cancelPick, saveSettings, drawFence } from './lightning.ts';

const recent = computed(() => {
    return state.strikes.slice(-10).reverse();
});

function fmtTime(ms: number): string {
    return new Date(ms).toISOString().substring(11, 19) + 'Z';
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
</script>
