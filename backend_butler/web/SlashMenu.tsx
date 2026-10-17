// Task 21 implements this; Task 24 wired it into Composer.
import type { SlashMenu as Menu } from "./slash";

/** The listbox above the composer while `menu.open`. */
export function SlashMenu({ menu }: { menu: Menu }) {
  if (!menu.open) return null;
  return (
    <ul className="slash-menu" role="listbox" id="slash-menu" aria-label="Skills">
      {menu.matches.map((s, i) => (
        <li
          key={s.name}
          role="option"
          id={`slash-opt-${s.name}`}
          aria-selected={i === menu.active}
          className="slash-opt"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => menu.pick(s.name)}
        >
          <span className="slash-name">/{s.name}</span>
          <span className="slash-desc">{s.description}</span>
        </li>
      ))}
    </ul>
  );
}
