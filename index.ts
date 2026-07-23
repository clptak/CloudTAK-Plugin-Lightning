import type { App } from 'vue';
import { h } from 'vue';
import type { PluginAPI, PluginInstance } from '@tak-ps/cloudtak';
import { TablerDropdown } from '@tak-ps/vue-tabler';
import MenuTemplate from './lib/MenuTemplate.vue';
import LightningContainer from './lib/LightningContainer.vue';
import IconBoltUrl from './lib/Bolt.svg';
import { state, init, destroy } from './lib/lightning.ts';

const IconBolt = {
    render: () => h('img', {
        src: IconBoltUrl,
        width: 32,
        height: 32
    })
};

const ROUTE_NAME = 'home-menu-plugin-lightning';
const MENU_KEY = 'lightning';
const BOTTOM_BAR_KEY = 'lightning-bottom-bar';

const LightningBottomBar = {
    render: () => h(TablerDropdown, {
        width: 260,
        position: 'top'
    }, {
        default: () => h('div', {
            class: 'd-flex align-items-center justify-content-center px-2 cursor-pointer cloudtak-hover',
            title: 'Lightning Monitor'
        }, [
            h('img', {
                src: IconBoltUrl,
                width: 28,
                height: 28,
                style: state.running
                    ? 'opacity: 0.95;'
                    : 'filter: grayscale(1); opacity: 0.5;'
            }),
            h('span', {
                class: 'small text-white ps-1'
            }, state.running ? String(state.strikes.length) : '')
        ]),
        dropdown: () => h('li', {
            class: 'dropdown-item-text px-3 py-2'
        }, [
            h('div', { class: 'fw-bold text-white' }, 'Lightning Monitor'),
            h('div', { class: 'text-white-50 small' },
                state.running
                    ? `${state.strikes.length} active strike(s) in radius — ` +
                      `${state.connected ? 'feed connected' : 'reconnecting…'}`
                    : 'Monitoring stopped. Open the Lightning menu to start.'
            )
        ])
    })
};

export default class Lightning {
    api: PluginAPI;

    constructor(api: PluginAPI) {
        this.api = api;

        // Routes register once at install time and are never removed —
        // removing routes at disable() breaks CloudTAK's router for
        // other consumers. routes.add() already no-ops if the route exists.
        this.api.routes.add({
            path: 'plugin-lightning',
            name: ROUTE_NAME,
            component: {
                render: () => h(MenuTemplate, { name: 'Lightning', backType: 'close' }, {
                    default: () => h(LightningContainer)
                })
            }
        }, 'home-menu');
    }

    static async install(
        app: App,
        api: PluginAPI
    ): Promise<PluginInstance> {
        return new Lightning(api);
    }

    async enable(): Promise<void> {
        init(this.api);

        this.api.menu.add({
            key: MENU_KEY,
            label: 'Lightning',
            route: ROUTE_NAME,
            tooltip: 'Lightning Monitor',
            description: 'Live Blitzortung strikes within a radius',
            icon: IconBolt
        });

        this.api.bottomBar.add({
            key: BOTTOM_BAR_KEY,
            component: LightningBottomBar
        });
    }

    async disable(): Promise<void> {
        destroy();
        this.api.bottomBar.remove(BOTTOM_BAR_KEY);
        this.api.menu.remove(MENU_KEY);
        // Intentionally NOT removing the route — see constructor note.
    }
}
