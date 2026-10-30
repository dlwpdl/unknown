// Resolves once the launch intro is off screen, so system prompts (tracking) never cover or block it.
let settle: () => void = () => {};
export const launchSettled = new Promise<void>(resolve => { settle = resolve; });
export const markLaunchSettled = () => settle();
