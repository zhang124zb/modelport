import type { ReactNode } from "react";

export type IconName =
  | "archive"
  | "brain"
  | "book"
  | "chat"
  | "chevron"
  | "close"
  | "cube"
  | "document"
  | "file"
  | "folder"
  | "globe"
  | "help"
  | "image"
  | "info"
  | "keyboard"
  | "library"
  | "maximize"
  | "mcp"
  | "minimize"
  | "panel"
  | "pin"
  | "plus"
  | "providers"
  | "robot"
  | "search"
  | "send"
  | "settings"
  | "sliders"
  | "spark"
  | "trash"
  | "wand";

const iconShapes: Record<IconName, ReactNode> = {
  trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></>,
  folder: <path d="M3 7V5h6l2 2h10v13H3V7Z" />,
  keyboard: <><rect x="2" y="5" width="20" height="14" rx="3"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10"/></>,
  book: <><path d="M12 5v15M12 5C8 2 3 4 3 4v15s5-2 9 1c4-3 9-1 9-1V4s-5-2-9 1Z"/></>,
  cube: <><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 5v10l9 5 9-5V8M12 13v10"/></>,
  document: <><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6"/></>,
  globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18ZM5 7h14M5 17h14"/></>,
  mcp: <><circle cx="12" cy="12" r="9" strokeDasharray="1 4"/><path d="M8 16V8l4 5 4-5v8"/></>,
  providers: <><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/></>,
  wand: <><path d="m5 19 11-11 3 3L8 22 5 19ZM14 10l3 3M5 3v6M2 6h6M18 2v4M16 4h4"/></>,
  archive: <><path d="M4 7.5h16"/><path d="M6 7.5V20h12V7.5"/><path d="M5 4h14l1 3.5H4L5 4Z"/><path d="M9.5 12h5"/></>,
  brain: <><path d="M9.5 4.5A3.5 3.5 0 0 0 6 8v.4A3.5 3.5 0 0 0 5.5 15v.5A3.5 3.5 0 0 0 9 19h.5"/><path d="M14.5 4.5A3.5 3.5 0 0 1 18 8v.4a3.5 3.5 0 0 1 .5 6.6v.5A3.5 3.5 0 0 1 15 19h-.5"/><path d="M9.5 4.5v15M14.5 4.5v15M6 9.5h3.5m5 5H18"/></>,
  chat: <path d="M21 11.5a8.5 8.5 0 0 1-9 8.5 9.8 9.8 0 0 1-4-.9L3 21l1.7-4.7A8.4 8.4 0 0 1 3 11.5a8.5 8.5 0 0 1 9-8.5 8.5 8.5 0 0 1 9 8.5Z"/>,
  chevron: <path d="m8 10 4 4 4-4"/>,
  close: <><path d="m6 6 12 12"/><path d="M18 6 6 18"/></>,
  file: <><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/><path d="m9 16 5-5 2 2-5 5-3 1z"/></>,
  help: <><circle cx="12" cy="12" r="9"/><path d="M9.7 9a2.5 2.5 0 1 1 3.6 2.25c-.8.4-1.3.9-1.3 1.75"/><path d="M12 17h.01"/></>,
  image: <><rect x="3" y="4" width="16" height="16" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m4 17 4-4 3 3 2-2 6 6"/><path d="M21 9v6m-3-3h6"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
  library: <><path d="M5 4h12a2 2 0 0 1 2 2v12H7a2 2 0 0 0-2 2V4Z"/><path d="M5 20a2 2 0 0 1 2-2h12M9 8h6"/></>,
  maximize: <rect x="5" y="5" width="14" height="14" rx="1.5"/>,
  minimize: <path d="M5 12h14"/>,
  panel: <><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 4v16M14 9l-2 3 2 3"/></>,
  pin: <path d="m8 3 8 3-2 4 3 3-4 2-3 6-1-7-4-2 4-3z"/>,
  plus: <><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></>,
  robot: <><rect x="5" y="7" width="14" height="11" rx="3"/><path d="M12 3v4M9 12h.01M15 12h.01M9 16h6"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></>,
  send: <><path d="M12 20V5"/><path d="m6 11 6-6 6 6"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
  sliders: <><path d="M4 7h8m4 0h4M4 17h4m4 0h8"/><circle cx="14" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></>,
  spark: <><path d="m12 3 1.4 4.1L17.5 9l-4.1 1.4L12 14.5l-1.4-4.1L6.5 9l4.1-1.9L12 3Z"/><path d="m18.5 14 .7 2.3 2.3.7-2.3.8-.7 2.2-.8-2.2-2.2-.8 2.2-.7.8-2.3Z"/></>,
};

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg aria-hidden="true" className="icon" fill="none" height={size} viewBox="0 0 24 24" width={size}>
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
        {iconShapes[name]}
      </g>
    </svg>
  );
}
