import express, { Request, Response } from 'express';
import turnstile from './lib/ends/turnstile';
import iuam from './lib/ends/iuam';
import { connect } from "./lib/browser/br";
import { BrowserPool, TabSlot } from "./lib/browser/pool";

const app = express();
const port = process.env.PORT || 407;
const authToken = process.env.authToken || null;

const POOL_SIZE = Number(process.env.browserLimit) || 20;
(global as any).browserLimit = POOL_SIZE;
(global as any).timeOut = Number(process.env.timeOut) || 60000;

const CACHE_TTL = 30 * 60 * 1000;

interface CacheEntry {
    expireAt: number;
    value: any;
}

interface Cache {
    [key: string]: CacheEntry;
}

const memoryCache: Cache = {};

async function readCache(key: string): Promise<any> {
    const entry = memoryCache[key];
    if (entry && Date.now() < entry.expireAt) {
        return entry.value;
    }
    return null;
}

async function writeCache(key: string, value: any, ttl: number = CACHE_TTL) {
    memoryCache[key] = { expireAt: Date.now() + ttl, value };
}

// ─── CLI colors ──────────────────────────────────────────────
const c = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    gray: '\x1b[90m',
    white: '\x1b[97m',
    magenta: '\x1b[35m',
    bgCyan: '\x1b[46m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgRed: '\x1b[41m',
};

function printBanner() {
    const banner = `
${c.cyan}${c.bold}
 ████████╗███████╗    ███████╗ ██████╗ ██╗    ██╗   ██╗███████╗██████╗ 
 ╚══██╔══╝██╔════╝    ██╔════╝██╔═══██╗██║    ██║   ██║██╔════╝██╔══██╗
    ██║   ███████╗    ███████╗██║   ██║██║    ██║   ██║█████╗  ██████╔╝
    ██║   ╚════██║    ╚════██║██║   ██║██║    ╚██╗ ██╔╝██╔══╝  ██╔══██╗
    ██║   ███████║    ███████║╚██████╔╝███████╗╚████╔╝ ███████╗██║  ██║
    ╚═╝   ╚══════╝    ╚══════╝ ╚═════╝ ╚══════╝ ╚═══╝  ╚══════╝╚═╝  ╚═╝
${c.reset}
${c.white}       Turnstile Solver  |  By @B00H0  |  t.me/HK407${c.reset}
`;
    console.log(banner);
}

function printStatus(message: string) {
    console.log(`${c.gray}─────────────────────────────────────────────${c.reset}`);
    console.log(`  ${c.white}${c.bold}${message}${c.reset}`);
    console.log(`${c.gray}─────────────────────────────────────────────${c.reset}`);
}

function logPost(tabId: number, url: string, siteKey?: string) {
    const tag = `${c.cyan}[POST]${c.reset}`;
    const tab = `${c.white}[Tab ${tabId}]${c.reset}`;
    const keyStr = siteKey ? ` | ${c.yellow}${siteKey}${c.reset}` : '';
    console.log(`${tag} ${tab} Incoming: ${c.white}${url}${c.reset}${keyStr}`);
}

function logDone(tabId: number, token: string, solveTime: string) {
    const tag = `${c.green}[DONE]${c.reset}`;
    const tab = `${c.white}[Tab ${tabId}]${c.reset}`;
    const truncated = token.length > 25 ? token.substring(0, 25) + '...' : token;
    console.log(`${tag} ${tab} token (${c.yellow}${truncated}${c.reset}) | solve_time: ${c.cyan}${solveTime}${c.reset}`);
}

function logError(tabId: number, message: string) {
    const tag = `${c.red}[ERR]${c.reset}`;
    const tab = `${c.white}[Tab ${tabId}]${c.reset}`;
    console.log(`${tag} ${tab} ${c.red}${message}${c.reset}`);
}

// ─── Pool ────────────────────────────────────────────────────
const pool = new BrowserPool(POOL_SIZE);

async function initPool() {
    const { browser } = await connect({
        headless: false,
        turnstile: true,
        connectOption: { defaultViewport: null },
        disableXvfb: false,
    });

    browser.on('disconnected', () => {
        console.log(`\n${c.red}${c.bold}Browser disconnected. Exiting...${c.reset}`);
        process.exit(1);
    });

    await pool.init(browser);
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Main route ──────────────────────────────────────────────
app.post('/cloudflare', async (req: Request, res: Response): Promise<any> => {
    const startTime = Date.now();
    const data = req.body;

    if (!data || typeof data.mode !== 'string') {
        return res.status(400).json({ message: 'Bad Request: missing or invalid mode' });
    }
    if (authToken && data.authToken !== authToken) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    let cacheKey: string = "", cached;
    if (data.mode === "iuam") {
        cacheKey = JSON.stringify(data);
        cached = await readCache(cacheKey);
        if (cached) {
            return res.status(200).json({ ...cached, cached: true, elapsed: ((Date.now() - startTime) / 1000).toFixed(2) + 's' });
        }
    }

    let slot: TabSlot | null = null;
    let result: any;

    try {
        slot = await pool.acquire();

        const page = slot.page;
        await page.setRequestInterception(true);
        page.removeAllListeners('request');
        page.removeAllListeners('response');
        page.on('request', async (req: any) => {
            const type = req.resourceType();
            if (["image", "stylesheet", "font", "media"].includes(type)) {
                await req.abort();
            } else {
                await req.continue();
            }
        });

        logPost(slot.id, data.domain || 'unknown', data.siteKey);

        switch (data.mode) {
            case "turnstile":
                result = await turnstile(data as any, page)
                    .then((token: string) => {
                        const solveTime = ((Date.now() - startTime) / 1000).toFixed(2) + 's';
                        logDone(slot!.id, token, solveTime);
                        return { token };
                    })
                    .catch((err: Error) => {
                        logError(slot!.id, err.message);
                        return { code: 500, message: err.message };
                    });
                break;

            case "iuam":
                result = await iuam(data as any, page)
                    .then((r: any) => {
                        const solveTime = ((Date.now() - startTime) / 1000).toFixed(2) + 's';
                        logDone(slot!.id, r.cf_clearance || 'ok', solveTime);
                        return { ...r };
                    })
                    .catch((err: Error) => {
                        logError(slot!.id, err.message);
                        return { code: 500, message: err.message };
                    });

                if (!result.code || result.code === 200) {
                    const ttl = Number(data.ttl || data.expire) || CACHE_TTL;
                    await writeCache(cacheKey, result, ttl);
                }
                break;

            default:
                result = { code: 400, message: 'Invalid mode' };
        }
    } catch (err: any) {
        result = { code: 500, message: err.message };
    } finally {
        if (slot) {
            try { await pool.release(slot); } catch { }
        }
    }

    if (!result.elapsed) {
        result.elapsed = ((Date.now() - startTime) / 1000).toFixed(2) + 's';
    }
    res.status(result.code ?? 200).json(result);
});

app.use(async (req: Request, res: Response) => {
    res.status(404).json({ message: 'Not Found' });
});

// ─── Startup ─────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'development') {
    (async () => {
        printBanner();

        try {
            await initPool();
            printStatus(`Server: http://0.0.0.0:${port}`);
            console.log(`\n${c.green}Ready - ${pool.getTotalCount()} tabs waiting for requests...${c.reset}\n`);
        } catch (err) {
            console.error(`${c.red}Failed to initialize browser pool:${c.reset}`, err);
            process.exit(1);
        }

        const server = app.listen(port, () => { });
        try {
            server.timeout = (global as any).timeOut;
        } catch { }
    })();
}

export default app;
