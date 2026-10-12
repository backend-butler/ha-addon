// `/` skill autocomplete. Task 21 implements this; Task 24 fixed the contract and wired it into Composer.
import { useEffect, useState, type KeyboardEvent, type RefObject, type TextareaHTMLAttributes } from "react";
import type { SkillSummary } from "../shared/transcript";
import { listSkills } from "./api";

export interface SlashMenu {
  open: boolean;
  /** Skills matching what follows the `/`. */
  matches: SkillSummary[];
  active: number;
  /** Insert `/<name> ` into the composer. */
  pick: (name: string) => void;
  /** Composer calls this first; true means the menu used the key (arrows, Enter, Tab, Esc). */
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  /** Combobox ARIA for the textarea (role, aria-expanded, aria-controls, aria-activedescendant, aria-autocomplete). */
  inputProps: TextareaHTMLAttributes<HTMLTextAreaElement>;
}

/** The text after the `/` while the whole input is one slash word, else null. */
export function parseSlash(input: string): string | null {
  const m = /^\/([a-z0-9-]*)$/.exec(input);
  return m ? m[1] : null;
}

/** Name-prefix first, then name-contains, then description-contains; list order within a rank. */
export function matchSkills(skills: SkillSummary[], query: string): SkillSummary[] {
  const q = query.toLowerCase();
  const rank = (s: SkillSummary) => {
    const name = s.name.toLowerCase();
    if (name.startsWith(q)) return 0;
    if (name.includes(q)) return 1;
    return s.description.toLowerCase().includes(q) ? 2 : 3;
  };
  return skills
    .map((s, i) => ({ s, i, r: rank(s) }))
    .filter((x) => x.r < 3)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.s);
}

/** Move the highlight by `delta`, wrapping at both ends. */
export function nextActive(i: number, delta: number, n: number): number {
  return n === 0 ? 0 : (((i + delta) % n) + n) % n;
}

// Loaded once per page, on the first `/`.
let cache: Promise<SkillSummary[]> | null = null;
function loadSkills(): Promise<SkillSummary[]> {
  if (!cache) {
    cache = listSkills().catch(() => {
      cache = null; // a failure means no menu; try again on a later `/`
      return [];
    });
  }
  return cache;
}

export function useSlashMenu(input: string, setInput: (v: string) => void, inputRef: RefObject<HTMLTextAreaElement | null>): SlashMenu {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [cursor, setCursor] = useState<{ query: string; i: number }>({ query: "", i: 0 });
  const [closedFor, setClosedFor] = useState<string | null>(null);

  const query = parseSlash(input);
  const wantsSkills = query !== null;

  useEffect(() => {
    if (!wantsSkills) return;
    let live = true;
    void loadSkills().then((list) => {
      if (live) setSkills(list);
    });
    return () => {
      live = false;
    };
  }, [wantsSkills]);

  const matches = query === null ? [] : matchSkills(skills, query);
  const open = query !== null && matches.length > 0 && closedFor !== input;
  const active = open && cursor.query === query ? Math.min(cursor.i, matches.length - 1) : 0;

  function pick(name: string) {
    const text = `/${name} `;
    setInput(text);
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(text.length, text.length);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!open || query === null) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      setCursor({ query, i: nextActive(active, e.key === "ArrowDown" ? 1 : -1, matches.length) });
    } else if (e.key === "Enter" || e.key === "Tab") {
      pick(matches[active].name);
    } else if (e.key === "Escape") {
      setClosedFor(input);
    } else {
      return false;
    }
    e.preventDefault();
    return true;
  }

  const inputProps: TextareaHTMLAttributes<HTMLTextAreaElement> =
    skills.length === 0
      ? {}
      : {
          role: "combobox",
          "aria-autocomplete": "list",
          "aria-expanded": open,
          "aria-controls": "slash-menu",
          "aria-activedescendant": open ? `slash-opt-${matches[active].name}` : undefined,
        };

  return { open, matches, active, pick, onKeyDown, inputProps };
}
