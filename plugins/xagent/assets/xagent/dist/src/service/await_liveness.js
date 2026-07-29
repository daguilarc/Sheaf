// Cadence sits under the tightest plausible client idle timeout (SDK default
// 60s; harness and undici body timers ~300s). One ping resets every layer.
//
export const x_AwaitLivenessPingIntervalMs = 30_000;
// Drive request-scoped progress notifications while the caller-supplied
// vouching predicate holds. Stopping vouching stops the ticker with no
// goodbye ping and no synthesized error — the client's own timeout then
// carries the information that vouching ended.
//
export function StartAwaitLivenessPings(options) {
    const scheduler = options.scheduler ?? systemScheduler;
    let stopped = false;
    let progress = 0;
    let handle;
    const clear = () => {
        if (handle !== undefined) {
            scheduler.clearTimeout(handle);
            handle = undefined;
        }
    };
    const schedule = () => {
        clear();
        if (stopped || options.signal.aborted) {
            return;
        }
        handle = scheduler.setTimeout(() => {
            void tick();
        }, options.intervalMs);
    };
    const tick = async () => {
        if (stopped || options.signal.aborted) {
            return;
        }
        if (!options.isVouching()) {
            return;
        }
        progress += 1;
        try {
            await options.sendNotification({
                method: "notifications/progress",
                params: {
                    progressToken: options.progressToken,
                    progress,
                    message: "await_liveness",
                },
            });
        }
        catch {
            // Client gone or transport closed — stop rather than retry forever.
            //
            return;
        }
        if (stopped || options.signal.aborted || !options.isVouching()) {
            return;
        }
        schedule();
    };
    schedule();
    return () => {
        stopped = true;
        clear();
    };
}
const systemScheduler = {
    setTimeout(callback, delayMs) {
        return setTimeout(callback, delayMs);
    },
    clearTimeout(handle) {
        clearTimeout(handle);
    },
};
//# sourceMappingURL=await_liveness.js.map