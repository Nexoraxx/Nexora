import { useState } from "react";

// run a request with busy / error state, for the dialogs below
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const act = (p: () => Promise<unknown>, done?: () => void) => {
    setBusy(true);
    setError(undefined);
    p()
      .then(done, (e) => setError(e.message))
      .finally(() => setBusy(false));
  };
  return { busy, error, setError, act };
}
