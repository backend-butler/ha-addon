// One icon family: 24px grid, 2px round strokes, currentColor.
const Icon = ({ children, size = 20 }: { children: React.ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {children}
  </svg>
);

export const PanelIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="M9.5 4v16" />
  </Icon>
);

export const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const TrashIcon = () => (
  <Icon size={18}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  </Icon>
);

export const HistoryIcon = () => (
  <Icon>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5" />
    <path d="M3.5 4v4.5H8M12 7.5V12l3 2" />
  </Icon>
);

export const ComposeIcon = () => (
  <Icon>
    <path d="M11 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V13" />
    <path d="M17.6 3.6a2 2 0 0 1 2.8 2.8L12 14.8l-3.5.7.7-3.5z" />
  </Icon>
);

export const ArchiveIcon = () => (
  <Icon size={18}>
    <rect x="3" y="4" width="18" height="5" rx="1.5" />
    <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4" />
  </Icon>
);

// Domain icons for outcome rows in the transcript (same family, 18px).
export const BulbIcon = () => (
  <Icon size={18}>
    <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z" />
  </Icon>
);

export const PowerIcon = () => (
  <Icon size={18}>
    <path d="M12 3v8M7.1 6.3a7 7 0 1 0 9.8 0" />
  </Icon>
);

export const FanIcon = () => (
  <Icon size={18}>
    <circle cx="12" cy="12" r="1.5" />
    <path d="M12 10.5C10.5 6 11 3 13.5 3S17 6.5 12 10.5zM13.5 12c4.5-1.5 7.5-1 7.5 1.5S17.5 17 13.5 12zM10.5 12C6 13.5 3 13 3 10.5S6.5 7 10.5 12zM12 13.5c1.5 4.5 1 7.5-1.5 7.5S7 17.5 12 13.5z" />
  </Icon>
);

export const ThermoIcon = () => (
  <Icon size={18}>
    <path d="M10 13.5V5a2 2 0 1 1 4 0v8.5a4 4 0 1 1-4 0zM12 10v6" />
  </Icon>
);

export const SpeakerIcon = () => (
  <Icon size={18}>
    <path d="M4 9.5v5h3.5L12 19V5L7.5 9.5zM16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" />
  </Icon>
);

export const VacuumIcon = () => (
  <Icon size={18}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="9" r="2" />
    <path d="M7.5 15.5h9" />
  </Icon>
);

export const PlayIcon = () => (
  <Icon size={18}>
    <path d="M8 5.5v13l10-6.5z" />
  </Icon>
);

export const FlowIcon = () => (
  <Icon size={18}>
    <rect x="3" y="4" width="7" height="5" rx="1.5" />
    <rect x="14" y="15" width="7" height="5" rx="1.5" />
    <path d="M6.5 9v3.5a2 2 0 0 0 2 2h9V15" />
  </Icon>
);

export const SearchIcon = () => (
  <Icon size={18}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4.4-4.4" />
  </Icon>
);

export const StopIcon = () => (
  <Icon size={18}>
    <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
  </Icon>
);
