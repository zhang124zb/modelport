export function createTextBatcher(onBatch: (text: string) => void) {
  let pending = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const text = pending; pending = "";
    if (text) onBatch(text);
  };
  return {
    push(text: string) {
      pending += text;
      if (pending && timer === undefined) timer = setTimeout(flush, 40);
    },
    flush,
    cancel() { if (timer !== undefined) clearTimeout(timer); timer = undefined; pending = ""; },
  };
}
