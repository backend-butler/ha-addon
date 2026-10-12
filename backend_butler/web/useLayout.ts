import { useEffect, useState } from "react";

const KEY = "bb.sidebarOpen";
const PHONE = "(max-width: 767px)";

function stored(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

/** Phone vs desktop layout, and the desktop chat list's open state (default open, remembered). */
export function useLayout() {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE).matches);
  const [open, setOpen] = useState(stored);

  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    const onChange = () => setPhone(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(KEY, open ? "0" : "1");
    } catch {
      /* storage unavailable: state just won't persist */
    }
  };

  return { phone, open, toggle };
}
