import { Browser, Page } from 'rebrowser-puppeteer-core';

export interface TabSlot {
    id: number;
    page: Page;
    busy: boolean;
}

export interface QueuedRequest {
    resolve: (slot: TabSlot) => void;
    reject: (err: Error) => void;
}

export class BrowserPool {
    private browser: Browser | null = null;
    private slots: TabSlot[] = [];
    private queue: QueuedRequest[] = [];
    private poolSize: number;
    private initPromise: Promise<void> | null = null;

    constructor(poolSize: number = 20) {
        this.poolSize = poolSize;
    }

    getBrowser(): Browser | null {
        return this.browser;
    }

    async init(browser: Browser): Promise<void> {
        if (this.initPromise) return this.initPromise;
        this.initPromise = this._init(browser);
        return this.initPromise;
    }

    private async _init(browser: Browser): Promise<void> {
        this.browser = browser;

        const existingPages = await browser.pages();
        for (const p of existingPages) {
            try { await p.close(); } catch { }
        }

        for (let i = 0; i < this.poolSize; i++) {
            try {
                const page = await browser.newPage();
                await page.goto('about:blank');
                this.slots.push({ id: i + 1, page, busy: false });
            } catch (err) {
                console.error(`Failed to create tab ${i + 1}:`, err);
            }
        }
    }

    getReadyCount(): number {
        return this.slots.filter(s => !s.busy).length;
    }

    getTotalCount(): number {
        return this.slots.length;
    }

    getBusyCount(): number {
        return this.slots.filter(s => s.busy).length;
    }

    getQueueLength(): number {
        return this.queue.length;
    }

    async acquire(): Promise<TabSlot> {
        const freeSlot = this.slots.find(s => !s.busy);
        if (freeSlot) {
            freeSlot.busy = true;
            return freeSlot;
        }

        return new Promise<TabSlot>((resolve, reject) => {
            this.queue.push({ resolve, reject });
        });
    }

    async release(slot: TabSlot): Promise<void> {
        try {
            await slot.page.goto('about:blank');
            slot.page.removeAllListeners('request');
            slot.page.removeAllListeners('response');
        } catch {
            try {
                if (this.browser && this.browser.isConnected()) {
                    const newPage = await this.browser.newPage();
                    await newPage.goto('about:blank');
                    slot.page = newPage;
                }
            } catch { }
        }

        slot.busy = false;

        if (this.queue.length > 0) {
            const next = this.queue.shift()!;
            slot.busy = true;
            next.resolve(slot);
        }
    }

    async shutdown(): Promise<void> {
        for (const q of this.queue) {
            q.reject(new Error('Pool shutting down'));
        }
        this.queue = [];

        for (const slot of this.slots) {
            try { await slot.page.close(); } catch { }
        }
        this.slots = [];

        if (this.browser) {
            try { await this.browser.close(); } catch { }
            this.browser = null;
        }
    }
}
